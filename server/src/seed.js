'use strict';

const path = require('node:path');
const { createDatabase } = require('./db');
const { validateSheetPayload } = require('./validation');

const SAMPLE_STUDENTS = [
  { rollNumber: '101', studentName: 'Aarav Patel' },
  { rollNumber: '102', studentName: 'Diya Sharma' },
  { rollNumber: '103', studentName: 'Rohan Verma' },
  { rollNumber: '104', studentName: 'Ananya Nair' },
  { rollNumber: '105', studentName: 'Kabir Mehta' },
  { rollNumber: '106', studentName: 'Priya Iyer' },
  { rollNumber: '107', studentName: 'Vikram Singh' },
  { rollNumber: '108', studentName: 'Sneha Kulkarni' },
  { rollNumber: '109', studentName: 'Arjun Reddy' },
  { rollNumber: '110', studentName: 'Meera Joshi' },
  { rollNumber: '111', studentName: 'Siddharth Rao' },
  { rollNumber: '112', studentName: 'Neha Deshmukh' },
];

function buildRecords(absentRollNumbers, baseTime) {
  const absentSet = new Set(absentRollNumbers);
  return SAMPLE_STUDENTS.map((student, idx) => {
    const [hh, mm] = baseTime.split(':').map(Number);
    const sec = String((idx * 4) % 60).padStart(2, '0');
    const minOffset = Math.floor((idx * 4) / 60);
    const totalMins = hh * 60 + mm + minOffset;
    const timeStr = `${String(Math.floor(totalMins / 60) % 24).padStart(2, '0')}:${String(totalMins % 60).padStart(2, '0')}:${sec}`;
    return {
      rollNumber: student.rollNumber,
      studentName: student.studentName,
      status: absentSet.has(student.rollNumber) ? 'Absent' : 'Present',
      markedTime: timeStr,
    };
  });
}

function getSampleSheets() {
  const rawSheets = [
    {
      clientSheetId: 'demo-sheet-1',
      title: 'Data Structures - Morning Session',
      subject: 'Data Structures',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Prof. R. Deshpande',
      date: '2026-11-23',
      time: '09:15:00',
      transferMethod: 'internet',
      sourceDevice: 'Pixel 7 (Faculty App)',
      records: buildRecords(['103', '109'], '09:15'),
    },
    {
      clientSheetId: 'demo-sheet-2',
      title: 'Computer Networks - Lecture 1',
      subject: 'Computer Networks',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Dr. S. Kulkarni',
      date: '2026-11-23',
      time: '11:30:00',
      transferMethod: 'bluetooth',
      sourceDevice: 'Samsung Galaxy A54 (Bluetooth)',
      records: buildRecords(['103', '107', '109'], '11:30'),
    },
    {
      clientSheetId: 'demo-sheet-3',
      title: 'Operating Systems - Lab Batch',
      subject: 'Operating Systems',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Prof. M. Menon',
      date: '2026-11-24',
      time: '10:05:00',
      transferMethod: 'internet',
      sourceDevice: 'OnePlus Nord (Faculty App)',
      records: buildRecords(['103', '109', '111'], '10:05'),
    },
    {
      clientSheetId: 'demo-sheet-4',
      title: 'Data Structures - Trees & Graphs',
      subject: 'Data Structures',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Prof. R. Deshpande',
      date: '2026-11-25',
      time: '09:10:00',
      transferMethod: 'internet',
      sourceDevice: 'Pixel 7 (Faculty App)',
      records: buildRecords(['105', '109'], '09:10'),
    },
    {
      clientSheetId: 'demo-sheet-5',
      title: 'Computer Networks - Routing Lab',
      subject: 'Computer Networks',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Dr. S. Kulkarni',
      date: '2026-11-25',
      time: '14:20:00',
      transferMethod: 'bluetooth',
      sourceDevice: 'Samsung Galaxy A54 (Bluetooth)',
      records: buildRecords(['103', '109', '112'], '14:20'),
    },
    {
      clientSheetId: 'demo-sheet-6',
      title: 'Operating Systems - Memory Management',
      subject: 'Operating Systems',
      className: 'B.Sc CS Sem 3',
      facultyName: 'Prof. M. Menon',
      date: '2026-11-26',
      time: '09:30:00',
      transferMethod: 'internet',
      sourceDevice: 'OnePlus Nord (Faculty App)',
      records: buildRecords(['103', '106'], '09:30'),
    },
  ];

  return rawSheets.map((s) => {
    const validated = validateSheetPayload(s);
    if (!validated.valid) {
      throw new Error(`Invalid seed sheet ${s.clientSheetId}: ${validated.errors.join('; ')}`);
    }
    return validated.data;
  });
}

function seedDatabase(db) {
  const sheets = getSampleSheets();
  let createdCount = 0;
  let updatedCount = 0;

  for (const sheet of sheets) {
    const res = db.upsertSheet(sheet);
    if (res.created) createdCount += 1;
    else updatedCount += 1;
  }

  return {
    totalSampleSheets: sheets.length,
    createdCount,
    updatedCount,
  };
}

if (require.main === module) {
  const defaultDbPath = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'attendance.db');
  const db = createDatabase(defaultDbPath);
  const summary = seedDatabase(db);
  db.close();
  console.log(`Seeded ${defaultDbPath}:`, summary);
}

module.exports = {
  SAMPLE_STUDENTS,
  getSampleSheets,
  seedDatabase,
};
