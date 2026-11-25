'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSheetPayload,
  parseCsvAttendance,
  naturalCompare,
  toCsv,
} = require('../src/validation');

test('validateSheetPayload normalizes valid payload and status aliases', () => {
  const result = validateSheetPayload({
    subject: 'Data Structures',
    date: '2026-11-26',
    time: '09:30',
    facultyName: 'Prof. Sharma',
    records: [
      { rollNumber: '10', studentName: 'Zara', status: 'p' },
      { rollNumber: '2', studentName: 'Aarav', status: 'ABSENT' },
    ],
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.time, '09:30:00');
  assert.equal(result.data.records[0].rollNumber, '2');
  assert.equal(result.data.records[0].status, 'Absent');
  assert.equal(result.data.records[1].rollNumber, '10');
  assert.equal(result.data.records[1].status, 'Present');
});

test('validateSheetPayload rejects invalid dates, empty records, and duplicate roll numbers', () => {
  const resBadDate = validateSheetPayload({
    subject: 'Math',
    date: '2026-02-30',
    records: [{ rollNumber: '1', studentName: 'A', status: 'Present' }],
  });
  assert.equal(resBadDate.valid, false);
  assert.ok(resBadDate.errors.some((e) => e.includes('date')));

  const resDupRoll = validateSheetPayload({
    subject: 'Math',
    date: '2026-11-26',
    records: [
      { rollNumber: '101', studentName: 'Aarav', status: 'Present' },
      { rollNumber: '101', studentName: 'Duplicate', status: 'Absent' },
    ],
  });
  assert.equal(resDupRoll.valid, false);
  assert.ok(resDupRoll.errors.some((e) => e.includes('Duplicate rollNumber')));

  const resEmpty = validateSheetPayload({
    subject: 'Math',
    date: '2026-11-26',
    records: [],
  });
  assert.equal(resEmpty.valid, false);
});

test('parseCsvAttendance handles quoted commas, alternate headers, and multi-date grouping', () => {
  const csv = [
    'Roll No,Name,"Absent/Present",Subject,Date,Time',
    '101,"Patel, Aarav",Present,Algorithms,2026-11-24,09:00',
    '102,"Sharma, Diya",A,Algorithms,2026-11-24,09:01',
    '101,"Patel, Aarav",P,Algorithms,2026-11-25,10:00',
  ].join('\r\n');

  const parsed = parseCsvAttendance(csv, { transferMethod: 'bluetooth' });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sheets.length, 2);
  assert.equal(parsed.sheets[0].date, '2026-11-24');
  assert.equal(parsed.sheets[0].records[0].studentName, 'Patel, Aarav');
  assert.equal(parsed.sheets[0].records[1].status, 'Absent');
  assert.equal(parsed.sheets[1].date, '2026-11-25');
  assert.equal(parsed.sheets[1].records[0].status, 'Present');
});

test('naturalCompare and toCsv work as expected', () => {
  assert.ok(naturalCompare('2', '10') < 0);
  assert.ok(naturalCompare('CS-2', 'CS-10') < 0);

  const csv = toCsv(
    [{ roll: '101', name: 'Patel, "Aarav"' }],
    [
      { key: 'roll', label: 'Roll' },
      { key: 'name', label: 'Student Name' },
    ]
  );
  assert.equal(csv, 'Roll,Student Name\r\n101,"Patel, ""Aarav"""');
});
