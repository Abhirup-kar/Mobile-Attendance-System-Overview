'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const db = createDatabase(':memory:');
  const server = createApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

test('full attendance lifecycle: transfers, upload, attendance check, sorting, analytics, delete', async () => {
  await withServer(async (baseUrl) => {
    // 1. Health check
    let res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.totalSheets, 0);

    // 2. Direct Internet transfer (POST /api/transfers)
    const sheetPayload = {
      clientSheetId: 'test-sheet-1',
      subject: 'Operating Systems',
      className: 'CS-A',
      facultyName: 'Prof. Menon',
      date: '2026-11-25',
      time: '09:15:00',
      transferMethod: 'internet',
      records: [
        { rollNumber: '10', studentName: 'Student Ten', status: 'Present', markedTime: '09:15:10' },
        { rollNumber: '2', studentName: 'Student Two', status: 'Absent', markedTime: '09:15:05' },
      ],
    };

    res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetPayload),
    });
    assert.equal(res.status, 201);
    body = await res.json();
    assert.equal(body.created, true);
    assert.equal(body.stats.present, 1);
    assert.equal(body.stats.absent, 1);

    // 3. Idempotent re-transfer updates existing sheet (200)
    sheetPayload.records[1].status = 'Present';
    res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetPayload),
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.created, false);
    assert.equal(body.stats.present, 2);

    // 4. Reject invalid payload
    res = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: '', date: 'bad', records: [] }),
    });
    assert.equal(res.status, 400);

    // 5. Bluetooth CSV file upload
    const csvContent = [
      'Roll No,Student Name,Status,Subject,Date,Time',
      '2,Student Two,Absent,Computer Networks,2026-11-26,10:00',
      '10,Student Ten,Present,Computer Networks,2026-11-26,10:01',
    ].join('\n');

    res = await fetch(`${baseUrl}/api/transfers/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'bt-export.csv',
        content: csvContent,
        transferMethod: 'bluetooth',
      }),
    });
    assert.equal(res.status, 201);
    body = await res.json();
    assert.equal(body.importedCount, 1);
    assert.equal(body.sheets[0].sheet.transferMethod, 'bluetooth');

    // 6. Attendance Check: filter by date & inspect presentees/absentees
    res = await fetch(`${baseUrl}/api/attendance?date=2026-11-26&sortBy=roll_number&sortDir=asc`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.records.length, 2);
    assert.equal(body.records[0].rollNumber, '2'); // natural sort: 2 before 10
    assert.equal(body.records[1].rollNumber, '10');
    assert.equal(body.presentees.length, 1);
    assert.equal(body.absentees.length, 1);
    assert.equal(body.absentees[0].rollNumber, '2');

    // 7. Sort by date ascending
    res = await fetch(`${baseUrl}/api/attendance?sortBy=date&sortDir=asc`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.records[0].date, '2026-11-25');
    assert.equal(body.records[body.records.length - 1].date, '2026-11-26');

    // 8. Export CSV
    res = await fetch(`${baseUrl}/api/attendance/export?date=2026-11-26`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const exportedCsv = await res.text();
    assert.match(exportedCsv, /Roll Number,Student Name/);
    assert.match(exportedCsv, /Student Two/);

    // 9. Analytics (Student 2 has 1/2 = 50% -> lowAttendance = true)
    res = await fetch(`${baseUrl}/api/analytics`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.overall.totalSheets, 2);
    assert.equal(body.overall.overallPercentage, 75);
    const st2 = body.byStudent.find((s) => s.rollNumber === '2');
    assert.equal(st2.percentage, 50);
    assert.equal(st2.lowAttendance, true);

    // 10. Seed idempotency
    res = await fetch(`${baseUrl}/api/demo/seed`, { method: 'POST' });
    assert.equal(res.status, 200);
    const seed1 = await res.json();
    assert.equal(seed1.createdCount, 6);

    res = await fetch(`${baseUrl}/api/demo/seed`, { method: 'POST' });
    assert.equal(res.status, 200);
    const seed2 = await res.json();
    assert.equal(seed2.createdCount, 0);
    assert.equal(seed2.updatedCount, 6);

    // 11. Delete sheet
    res = await fetch(`${baseUrl}/api/sheets`);
    const sheetsList = await res.json();
    const firstId = sheetsList.sheets[0].id;
    res = await fetch(`${baseUrl}/api/sheets/${firstId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/sheets/${firstId}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

test('static routes and path traversal protection', async () => {
  await withServer(async (baseUrl) => {
    for (const p of ['/', '/mobile', '/mobile/manifest.webmanifest', '/mobile/sw.js', '/shared/styles.css', '/shared/utils.js']) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 200, `Expected 200 for ${p}`);
    }

    const traversal = await fetch(`${baseUrl}/..%2Fpackage.json`);
    assert.ok(traversal.status === 403 || traversal.status === 404);
  });
});
