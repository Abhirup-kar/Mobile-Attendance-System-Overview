'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const {
  validateSheetPayload,
  parseCsvAttendance,
  toCsv,
} = require('./validation');
const { seedDatabase } = require('./seed');

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, message, contentType = 'text/plain; charset=utf-8') {
  const body = String(message);
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!aborted) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });

    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

function getQueryFilters(searchParams) {
  return {
    date: searchParams.get('date') || undefined,
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
    subject: searchParams.get('subject') || undefined,
    rollNumber: searchParams.get('rollNumber') || undefined,
    search: searchParams.get('search') || undefined,
    status: searchParams.get('status') || undefined,
    faculty: searchParams.get('faculty') || undefined,
    transferMethod: searchParams.get('transferMethod') || undefined,
    sortBy: searchParams.get('sortBy') || undefined,
    sortDir: searchParams.get('sortDir') || undefined,
  };
}

function createApp(db, options = {}) {
  const webRoot = path.resolve(options.webRoot || path.resolve(__dirname, '..', '..', 'web'));

  function serveStaticFile(req, res, pathname) {
    let relPath = pathname;
    if (relPath === '/' || relPath === '/operator' || relPath === '/operator/') {
      relPath = '/operator/index.html';
    } else if (relPath === '/mobile' || relPath === '/mobile/') {
      relPath = '/mobile/index.html';
    }

    let decoded;
    try {
      decoded = decodeURIComponent(relPath);
    } catch (_) {
      sendText(res, 400, 'Bad Request');
      return;
    }

    if (decoded.includes('\0')) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    const stripped = decoded.replace(/^\/+/, '');
    const resolved = path.resolve(webRoot, stripped);

    if (resolved !== webRoot && !resolved.startsWith(webRoot + path.sep)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    fs.stat(resolved, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        sendText(res, 404, 'Not Found');
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Content-Length': stats.size,
      };
      if (path.basename(resolved) === 'sw.js') {
        headers['Cache-Control'] = 'no-cache';
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(resolved);
      stream.on('error', () => {
        if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
        else res.end();
      });
      stream.pipe(res);
    });
  }

  async function handleUploadTransfer(req, res, urlObj) {
    const rawBody = await readRequestBody(req);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const queryDefaults = {
      transferMethod: urlObj.searchParams.get('transferMethod') || 'bluetooth',
      subject: urlObj.searchParams.get('subject') || undefined,
      date: urlObj.searchParams.get('date') || undefined,
      time: urlObj.searchParams.get('time') || undefined,
      className: urlObj.searchParams.get('className') || undefined,
      facultyName: urlObj.searchParams.get('facultyName') || undefined,
      sourceDevice: urlObj.searchParams.get('sourceDevice') || 'Bluetooth / File Import',
    };

    if (!rawBody.trim()) {
      sendJson(res, 400, { error: 'Empty upload body' });
      return;
    }

    let rawContent = rawBody;
    let filename = urlObj.searchParams.get('filename') || '';
    let defaults = { ...queryDefaults };

    // Try JSON first unless explicitly text/csv
    let parsedJson = null;
    if (!contentType.includes('text/csv')) {
      try {
        parsedJson = JSON.parse(rawBody);
      } catch (_) {
        parsedJson = null;
      }
    }

    if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson) && typeof parsedJson.content === 'string') {
      rawContent = parsedJson.content;
      filename = parsedJson.filename || filename;
      defaults = {
        transferMethod: parsedJson.transferMethod || defaults.transferMethod || 'bluetooth',
        subject: parsedJson.subject || defaults.subject,
        date: parsedJson.date || defaults.date,
        time: parsedJson.time || defaults.time,
        className: parsedJson.className || defaults.className,
        facultyName: parsedJson.facultyName || defaults.facultyName,
        sourceDevice: parsedJson.sourceDevice || defaults.sourceDevice,
      };
      parsedJson = null;
      const trimmedInner = rawContent.trim();
      if (trimmedInner.startsWith('{') || trimmedInner.startsWith('[')) {
        try {
          parsedJson = JSON.parse(trimmedInner);
        } catch (err) {
          sendJson(res, 400, { error: 'Invalid JSON file content', details: [err.message] });
          return;
        }
      }
    }

    let validatedSheets = [];
    if (parsedJson !== null) {
      const sheetList = Array.isArray(parsedJson)
        ? parsedJson
        : Array.isArray(parsedJson.sheets)
          ? parsedJson.sheets
          : [parsedJson];

      const errors = [];
      for (const item of sheetList) {
        const resVal = validateSheetPayload(item, defaults);
        if (!resVal.valid) {
          errors.push(...resVal.errors);
        } else {
          validatedSheets.push(resVal.data);
        }
      }
      if (errors.length > 0) {
        sendJson(res, 400, { error: 'Validation failed', details: errors });
        return;
      }
    } else if (filename.toLowerCase().endsWith('.json')) {
      sendJson(res, 400, { error: 'Invalid JSON file content' });
      return;
    } else {
      const csvResult = parseCsvAttendance(rawContent, defaults);
      if (!csvResult.valid) {
        sendJson(res, 400, { error: 'CSV validation failed', details: csvResult.errors });
        return;
      }
      validatedSheets = csvResult.sheets;
    }

    const imported = validatedSheets.map((sheet) => db.upsertSheet(sheet));
    sendJson(res, 201, {
      importedCount: imported.length,
      sheets: imported,
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch (_) {
      sendJson(res, 400, { error: 'Invalid request URL' });
      return;
    }

    const pathname = urlObj.pathname;

    try {
      if (pathname.startsWith('/api/')) {
        // Health
        if (req.method === 'GET' && pathname === '/api/health') {
          const stats = db.getHealthStats();
          sendJson(res, 200, {
            status: 'ok',
            timestamp: new Date().toISOString(),
            ...stats,
          });
          return;
        }

        // Direct JSON transfer from Mobile App
        if (req.method === 'POST' && pathname === '/api/transfers') {
          const rawBody = await readRequestBody(req);
          let payload;
          try {
            payload = JSON.parse(rawBody);
          } catch (_) {
            sendJson(res, 400, { error: 'Request body must be valid JSON' });
            return;
          }

          const validation = validateSheetPayload(payload);
          if (!validation.valid) {
            sendJson(res, 400, { error: 'Validation failed', details: validation.errors });
            return;
          }

          const result = db.upsertSheet(validation.data);
          sendJson(res, result.created ? 201 : 200, result);
          return;
        }

        // File upload (Bluetooth / CSV / JSON)
        if (req.method === 'POST' && pathname === '/api/transfers/upload') {
          await handleUploadTransfer(req, res, urlObj);
          return;
        }

        // Sheets list
        if (req.method === 'GET' && pathname === '/api/sheets') {
          const filters = getQueryFilters(urlObj.searchParams);
          const sheets = db.listSheets(filters);
          sendJson(res, 200, { sheets, total: sheets.length });
          return;
        }

        // Single sheet get / delete
        const sheetMatch = /^\/api\/sheets\/(\d+)$/.exec(pathname);
        if (sheetMatch) {
          const sheetId = Number(sheetMatch[1]);
          if (req.method === 'GET') {
            const detail = db.getSheetById(sheetId);
            if (!detail) {
              sendJson(res, 404, { error: 'Attendance sheet not found' });
              return;
            }
            sendJson(res, 200, detail);
            return;
          }
          if (req.method === 'DELETE') {
            const deleted = db.deleteSheet(sheetId);
            if (!deleted) {
              sendJson(res, 404, { error: 'Attendance sheet not found' });
              return;
            }
            sendJson(res, 200, { deleted: true, id: sheetId });
            return;
          }
        }

        // Attendance query
        if (req.method === 'GET' && pathname === '/api/attendance') {
          const filters = getQueryFilters(urlObj.searchParams);
          const data = db.queryAttendance(filters);
          sendJson(res, 200, data);
          return;
        }

        // Attendance CSV export
        if (req.method === 'GET' && pathname === '/api/attendance/export') {
          const filters = getQueryFilters(urlObj.searchParams);
          const data = db.queryAttendance(filters);
          const csv = toCsv(data.records, [
            { key: 'rollNumber', label: 'Roll Number' },
            { key: 'studentName', label: 'Student Name' },
            { key: 'subject', label: 'Subject' },
            { key: 'className', label: 'Class' },
            { key: 'date', label: 'Date' },
            { key: 'time', label: 'Time' },
            { key: 'status', label: 'Status' },
            { key: 'facultyName', label: 'Faculty' },
            { key: 'transferMethod', label: 'Transfer Method' },
          ]);
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="attendance-report.csv"',
            'Content-Length': Buffer.byteLength(csv),
          });
          res.end(csv);
          return;
        }

        // Analytics
        if (req.method === 'GET' && pathname === '/api/analytics') {
          const filters = getQueryFilters(urlObj.searchParams);
          const analytics = db.getAnalytics(filters);
          sendJson(res, 200, analytics);
          return;
        }

        // Demo seed
        if (req.method === 'POST' && pathname === '/api/demo/seed') {
          const summary = seedDatabase(db);
          sendJson(res, 200, summary);
          return;
        }

        sendJson(res, 404, { error: `Unknown API route: ${req.method} ${pathname}` });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed');
        return;
      }

      serveStaticFile(req, res, pathname);
    } catch (err) {
      if (err && err.statusCode === 413) {
        sendJson(res, 413, { error: 'Payload exceeds 5 MB limit' });
        return;
      }
      console.error('Server error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  });

  return server;
}

module.exports = {
  createApp,
};
