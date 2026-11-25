'use strict';

const crypto = require('node:crypto');

const ALLOWED_TRANSFER_METHODS = new Set(['internet', 'bluetooth', 'file_import']);

/**
 * Returns local calendar date as YYYY-MM-DD.
 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns local time as HH:MM:SS.
 */
function getLocalTimeString(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Validates YYYY-MM-DD as a real calendar date.
 */
function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Validates HH:MM or HH:MM:SS and returns normalized HH:MM:SS or null.
 */
function normalizeTime(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] !== undefined ? Number(match[3]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
    return null;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isValidTime(str) {
  return normalizeTime(str) !== null;
}

/**
 * Normalizes Present/Absent status strings.
 */
function normalizeStatus(val) {
  if (val === true || val === 1) return 'Present';
  if (val === false || val === 0) return 'Absent';
  if (typeof val !== 'string') return null;
  const key = val.trim().toLowerCase();
  if (key === 'present' || key === 'p' || key === '1' || key === 'true') {
    return 'Present';
  }
  if (key === 'absent' || key === 'a' || key === '0' || key === 'false') {
    return 'Absent';
  }
  return null;
}

/**
 * Natural alphanumeric comparator (e.g., "2" before "10", "CS-2" before "CS-10").
 */
function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function cleanString(val, maxLen = 200) {
  if (val === undefined || val === null) return '';
  return String(val).trim().slice(0, maxLen);
}

/**
 * Validates and normalizes an incoming attendance sheet JSON payload.
 */
function validateSheetPayload(payload, defaults = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  const subject = cleanString(payload.subject ?? defaults.subject, 120);
  if (!subject) {
    errors.push('subject is required');
  }

  const rawDate = cleanString(payload.date ?? payload.attendanceDate ?? payload.attendance_date ?? defaults.date, 20);
  if (!rawDate || !isValidDate(rawDate)) {
    errors.push('date must be a valid YYYY-MM-DD date');
  }

  const rawTime = cleanString(payload.time ?? payload.attendanceTime ?? payload.attendance_time ?? defaults.time, 20);
  let normalizedTime;
  if (!rawTime) {
    normalizedTime = getLocalTimeString();
  } else {
    normalizedTime = normalizeTime(rawTime);
    if (!normalizedTime) {
      errors.push('time must be in HH:MM or HH:MM:SS format');
    }
  }

  const className = cleanString(payload.className ?? payload.class_name ?? defaults.className ?? '', 120);
  const facultyName = cleanString(payload.facultyName ?? payload.faculty_name ?? defaults.facultyName ?? '', 120) || 'Faculty';
  const rawClientSheetId = cleanString(payload.clientSheetId ?? payload.client_sheet_id ?? defaults.clientSheetId, 120);
  const clientSheetId = rawClientSheetId || crypto.randomUUID();

  let transferMethod = cleanString(
    payload.transferMethod ?? payload.transfer_method ?? defaults.transferMethod ?? 'internet',
    32
  ).toLowerCase();
  if (!transferMethod) transferMethod = 'internet';
  if (!ALLOWED_TRANSFER_METHODS.has(transferMethod)) {
    errors.push(`transferMethod must be one of: ${Array.from(ALLOWED_TRANSFER_METHODS).join(', ')}`);
  }

  const sourceDevice = cleanString(
    payload.sourceDevice ?? payload.source_device ?? defaults.sourceDevice ?? 'Android Mobile App',
    120
  ) || 'Android Mobile App';

  const title = cleanString(payload.title ?? defaults.title, 200) || (subject && rawDate ? `${subject} (${rawDate})` : 'Attendance Sheet');

  const rawRecords = payload.records;
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    errors.push('records must be a non-empty array of student attendance entries');
  }

  const normalizedRecords = [];
  const seenRolls = new Set();

  if (Array.isArray(rawRecords)) {
    rawRecords.forEach((rec, idx) => {
      if (!rec || typeof rec !== 'object') {
        errors.push(`records[${idx}] must be an object`);
        return;
      }
      const rollNumber = cleanString(rec.rollNumber ?? rec.roll_number ?? rec.rollNo ?? rec.roll, 64);
      const studentName = cleanString(rec.studentName ?? rec.student_name ?? rec.name ?? rec.student, 120);
      const rawStatus = rec.status ?? rec.mark ?? rec.attendance;
      const status = normalizeStatus(rawStatus);
      const remarks = cleanString(rec.remarks ?? rec.note ?? '', 250);

      if (!rollNumber) {
        errors.push(`records[${idx}].rollNumber is required`);
      } else {
        const rollKey = rollNumber.toLowerCase();
        if (seenRolls.has(rollKey)) {
          errors.push(`Duplicate rollNumber "${rollNumber}" in records`);
        } else {
          seenRolls.add(rollKey);
        }
      }

      if (!studentName) {
        errors.push(`records[${idx}].studentName is required`);
      }

      if (!status) {
        errors.push(`records[${idx}].status must be "Present" or "Absent"`);
      }

      let markedTime = normalizedTime || getLocalTimeString();
      const rawMarkedTime = cleanString(rec.markedTime ?? rec.marked_time ?? rec.time, 20);
      if (rawMarkedTime) {
        const parsedMarked = normalizeTime(rawMarkedTime);
        if (!parsedMarked) {
          errors.push(`records[${idx}].markedTime must be HH:MM or HH:MM:SS`);
        } else {
          markedTime = parsedMarked;
        }
      }

      if (rollNumber && studentName && status) {
        normalizedRecords.push({
          rollNumber,
          studentName,
          status,
          markedTime,
          remarks,
        });
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  normalizedRecords.sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber));

  return {
    valid: true,
    data: {
      clientSheetId,
      title,
      subject,
      className,
      facultyName,
      date: rawDate,
      time: normalizedTime,
      transferMethod,
      sourceDevice,
      records: normalizedRecords,
    },
  };
}

/**
 * RFC-4180 compliant CSV parser returning array of rows (each an array of strings).
 */
function parseCsvRows(csvText) {
  const text = String(csvText ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function normalizeHeaderKey(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const HEADER_ALIASES = {
  roll_number: 'rollNumber',
  roll_no: 'rollNumber',
  rollnumber: 'rollNumber',
  rollno: 'rollNumber',
  roll: 'rollNumber',
  student_name: 'studentName',
  name: 'studentName',
  student: 'studentName',
  status: 'status',
  mark: 'status',
  attendance: 'status',
  absent_present: 'status',
  absent_present_mark: 'status',
  date: 'date',
  attendance_date: 'date',
  time: 'time',
  marked_time: 'time',
  attendance_time: 'time',
  subject: 'subject',
  course: 'subject',
  class: 'className',
  class_name: 'className',
  section: 'className',
  faculty: 'facultyName',
  faculty_name: 'facultyName',
  teacher: 'facultyName',
  remarks: 'remarks',
  notes: 'remarks',
  client_sheet_id: 'clientSheetId',
};

/**
 * Parses CSV attendance text into one or more validated sheet payloads.
 * Groups rows by (date, subject, className, facultyName).
 */
function parseCsvAttendance(csvText, defaults = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return { valid: false, errors: ['CSV must contain a header row and at least one student row'] };
  }

  const rawHeaders = rows[0];
  const mappedHeaders = rawHeaders.map((h) => HEADER_ALIASES[normalizeHeaderKey(h)] || null);

  if (!mappedHeaders.includes('rollNumber') || !mappedHeaders.includes('studentName') || !mappedHeaders.includes('status')) {
    return {
      valid: false,
      errors: ['CSV must include Roll Number, Student Name, and Status (Present/Absent) columns'],
    };
  }

  const groups = new Map();
  const fallbackDate = cleanString(defaults.date, 20) || getLocalDateString();
  const fallbackTime = cleanString(defaults.time, 20) || getLocalTimeString();
  const fallbackSubject = cleanString(defaults.subject, 120);
  const fallbackClass = cleanString(defaults.className, 120);
  const fallbackFaculty = cleanString(defaults.facultyName, 120) || 'Faculty';
  const transferMethod = cleanString(defaults.transferMethod, 32) || 'bluetooth';
  const sourceDevice = cleanString(defaults.sourceDevice, 120) || 'Bluetooth / File Import';

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const entry = {};
    mappedHeaders.forEach((field, colIdx) => {
      if (field) {
        entry[field] = cleanString(cells[colIdx] ?? '', 250);
      }
    });

    const date = entry.date || fallbackDate;
    const subject = entry.subject || fallbackSubject;
    const className = entry.className || fallbackClass;
    const facultyName = entry.facultyName || fallbackFaculty;
    const rowTime = entry.time || fallbackTime;
    const groupKey = `${date}::${subject}::${className}::${facultyName}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        clientSheetId: entry.clientSheetId || defaults.clientSheetId || undefined,
        subject,
        className,
        facultyName,
        date,
        time: rowTime,
        transferMethod,
        sourceDevice,
        records: [],
      });
    }

    groups.get(groupKey).records.push({
      rollNumber: entry.rollNumber,
      studentName: entry.studentName,
      status: entry.status,
      markedTime: rowTime,
      remarks: entry.remarks || '',
    });
  }

  const sheets = [];
  const allErrors = [];
  let idx = 0;

  for (const group of groups.values()) {
    idx += 1;
    if (!group.clientSheetId) {
      const slug = `${group.date}-${group.subject}-${group.className}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
      group.clientSheetId = `csv-${slug || 'sheet'}-${idx}-${crypto.createHash('sha1').update(JSON.stringify(group.records)).digest('hex').slice(0, 8)}`;
    }
    const result = validateSheetPayload(group);
    if (!result.valid) {
      allErrors.push(...result.errors);
    } else {
      sheets.push(result.data);
    }
  }

  if (allErrors.length > 0) {
    return { valid: false, errors: allErrors };
  }

  return { valid: true, sheets };
}

/**
 * Safely encodes an array of row objects into RFC-4180 CSV.
 */
function toCsv(rows, columns) {
  const escapeCell = (val) => {
    const str = val === undefined || val === null ? '' : String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [columns.map((c) => escapeCell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c.key])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = {
  ALLOWED_TRANSFER_METHODS,
  getLocalDateString,
  getLocalTimeString,
  isValidDate,
  isValidTime,
  normalizeTime,
  normalizeStatus,
  naturalCompare,
  validateSheetPayload,
  parseCsvRows,
  parseCsvAttendance,
  toCsv,
};
