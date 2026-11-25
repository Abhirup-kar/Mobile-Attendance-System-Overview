'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { naturalCompare } = require('./validation');

function computeStats(records) {
  const total = records.length;
  let present = 0;
  let absent = 0;
  for (const r of records) {
    if (r.status === 'Present') present += 1;
    else if (r.status === 'Absent') absent += 1;
  }
  const percentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;
  return { total, present, absent, percentage };
}

function mapSheetRow(row) {
  if (!row) return null;
  const totalCount = Number(row.total_count ?? row.totalCount ?? 0);
  const presentCount = Number(row.present_count ?? row.presentCount ?? 0);
  const absentCount = Number(row.absent_count ?? row.absentCount ?? 0);
  return {
    id: row.id,
    clientSheetId: row.client_sheet_id,
    title: row.title,
    subject: row.subject,
    className: row.class_name,
    facultyName: row.faculty_name,
    date: row.attendance_date,
    time: row.attendance_time,
    transferMethod: row.transfer_method,
    sourceDevice: row.source_device,
    transferredAt: row.transferred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount,
    presentCount,
    absentCount,
    attendancePercentage: totalCount > 0 ? Number(((presentCount / totalCount) * 100).toFixed(1)) : 0,
  };
}

function createDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_sheet_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      class_name TEXT NOT NULL DEFAULT '',
      faculty_name TEXT NOT NULL DEFAULT 'Faculty',
      attendance_date TEXT NOT NULL,
      attendance_time TEXT NOT NULL,
      transfer_method TEXT NOT NULL CHECK(transfer_method IN ('internet', 'bluetooth', 'file_import')) DEFAULT 'internet',
      source_device TEXT NOT NULL DEFAULT 'Android Mobile App',
      transferred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES attendance_sheets(id) ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      student_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Present', 'Absent')),
      marked_time TEXT NOT NULL,
      remarks TEXT NOT NULL DEFAULT '',
      UNIQUE(sheet_id, roll_number)
    );

    CREATE INDEX IF NOT EXISTS idx_sheets_date ON attendance_sheets(attendance_date);
    CREATE INDEX IF NOT EXISTS idx_sheets_subject ON attendance_sheets(subject);
    CREATE INDEX IF NOT EXISTS idx_records_sheet ON attendance_records(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_records_roll ON attendance_records(roll_number);
    CREATE INDEX IF NOT EXISTS idx_records_status ON attendance_records(status);
  `);

  const findByClientIdStmt = db.prepare(
    'SELECT id FROM attendance_sheets WHERE client_sheet_id = ?'
  );
  const insertSheetStmt = db.prepare(`
    INSERT INTO attendance_sheets (
      client_sheet_id, title, subject, class_name, faculty_name,
      attendance_date, attendance_time, transfer_method, source_device,
      transferred_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSheetStmt = db.prepare(`
    UPDATE attendance_sheets
    SET title = ?, subject = ?, class_name = ?, faculty_name = ?,
        attendance_date = ?, attendance_time = ?, transfer_method = ?,
        source_device = ?, transferred_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const deleteRecordsBySheetStmt = db.prepare(
    'DELETE FROM attendance_records WHERE sheet_id = ?'
  );
  const insertRecordStmt = db.prepare(`
    INSERT INTO attendance_records (
      sheet_id, roll_number, student_name, status, marked_time, remarks
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  function getSheetById(id) {
    const sheetRow = db
      .prepare(`
        SELECT s.*,
          COUNT(r.id) AS total_count,
          SUM(CASE WHEN r.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
          SUM(CASE WHEN r.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count
        FROM attendance_sheets s
        LEFT JOIN attendance_records r ON r.sheet_id = s.id
        WHERE s.id = ?
        GROUP BY s.id
      `)
      .get(Number(id));

    if (!sheetRow) return null;

    const recordRows = db
      .prepare('SELECT id, sheet_id, roll_number, student_name, status, marked_time, remarks FROM attendance_records WHERE sheet_id = ?')
      .all(sheetRow.id);

    const records = recordRows
      .map((r) => ({
        id: r.id,
        sheetId: r.sheet_id,
        rollNumber: r.roll_number,
        studentName: r.student_name,
        status: r.status,
        markedTime: r.marked_time,
        remarks: r.remarks,
      }))
      .sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber));

    return {
      sheet: mapSheetRow(sheetRow),
      records,
      stats: computeStats(records),
    };
  }

  function upsertSheet(sheet) {
    const nowIso = new Date().toISOString();
    let sheetId;
    let created = false;

    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = findByClientIdStmt.get(sheet.clientSheetId);
      if (existing) {
        sheetId = existing.id;
        updateSheetStmt.run(
          sheet.title,
          sheet.subject,
          sheet.className,
          sheet.facultyName,
          sheet.date,
          sheet.time,
          sheet.transferMethod,
          sheet.sourceDevice,
          nowIso,
          nowIso,
          sheetId
        );
        deleteRecordsBySheetStmt.run(sheetId);
      } else {
        created = true;
        const result = insertSheetStmt.run(
          sheet.clientSheetId,
          sheet.title,
          sheet.subject,
          sheet.className,
          sheet.facultyName,
          sheet.date,
          sheet.time,
          sheet.transferMethod,
          sheet.sourceDevice,
          nowIso,
          nowIso,
          nowIso
        );
        sheetId = Number(result.lastInsertRowid);
      }

      for (const rec of sheet.records) {
        insertRecordStmt.run(
          sheetId,
          rec.rollNumber,
          rec.studentName,
          rec.status,
          rec.markedTime,
          rec.remarks || ''
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        // Ignore rollback failure if transaction wasn't active
      }
      throw err;
    }

    const full = getSheetById(sheetId);
    return {
      created,
      sheet: full.sheet,
      records: full.records,
      stats: full.stats,
    };
  }

  function listSheets(filters = {}) {
    const where = [];
    const params = [];

    if (filters.date) {
      where.push('s.attendance_date = ?');
      params.push(filters.date);
    }
    if (filters.subject) {
      where.push('LOWER(s.subject) = LOWER(?)');
      params.push(filters.subject);
    }
    if (filters.faculty) {
      where.push('LOWER(s.faculty_name) LIKE LOWER(?)');
      params.push(`%${filters.faculty}%`);
    }
    if (filters.transferMethod) {
      where.push('s.transfer_method = ?');
      params.push(filters.transferMethod);
    }

    const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortColumnMap = {
      date: `s.attendance_date ${sortDir}, s.attendance_time ${sortDir}, s.id ${sortDir}`,
      transferred_at: `s.transferred_at ${sortDir}, s.id ${sortDir}`,
      subject: `LOWER(s.subject) ${sortDir}, s.attendance_date DESC`,
    };
    const orderBy = sortColumnMap[filters.sortBy] || sortColumnMap.date;
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(`
        SELECT s.*,
          COUNT(r.id) AS total_count,
          SUM(CASE WHEN r.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
          SUM(CASE WHEN r.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count
        FROM attendance_sheets s
        LEFT JOIN attendance_records r ON r.sheet_id = s.id
        ${whereSql}
        GROUP BY s.id
        ORDER BY ${orderBy}
      `)
      .all(...params);

    return rows.map(mapSheetRow);
  }

  function deleteSheet(id) {
    const info = db.prepare('DELETE FROM attendance_sheets WHERE id = ?').run(Number(id));
    return info.changes > 0;
  }

  function queryAttendance(filters = {}) {
    const where = [];
    const params = [];

    if (filters.date) {
      where.push('s.attendance_date = ?');
      params.push(filters.date);
    }
    if (filters.dateFrom) {
      where.push('s.attendance_date >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.push('s.attendance_date <= ?');
      params.push(filters.dateTo);
    }
    if (filters.subject) {
      where.push('LOWER(s.subject) = LOWER(?)');
      params.push(filters.subject);
    }
    if (filters.rollNumber) {
      where.push('LOWER(r.roll_number) LIKE LOWER(?)');
      params.push(`%${filters.rollNumber.trim()}%`);
    }
    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      where.push('(LOWER(r.roll_number) LIKE LOWER(?) OR LOWER(r.student_name) LIKE LOWER(?) OR LOWER(s.subject) LIKE LOWER(?) OR LOWER(s.faculty_name) LIKE LOWER(?))');
      params.push(term, term, term, term);
    }
    if (filters.status) {
      const normalized = String(filters.status).trim().toLowerCase();
      if (normalized === 'present') {
        where.push("r.status = 'Present'");
      } else if (normalized === 'absent') {
        where.push("r.status = 'Absent'");
      }
    }
    if (filters.faculty) {
      where.push('LOWER(s.faculty_name) LIKE LOWER(?)');
      params.push(`%${filters.faculty.trim()}%`);
    }
    if (filters.transferMethod) {
      where.push('s.transfer_method = ?');
      params.push(filters.transferMethod);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT
          r.id,
          r.sheet_id,
          r.roll_number,
          r.student_name,
          r.status,
          r.marked_time,
          r.remarks,
          s.client_sheet_id,
          s.title AS sheet_title,
          s.subject,
          s.class_name,
          s.faculty_name,
          s.attendance_date,
          s.attendance_time,
          s.transfer_method,
          s.source_device,
          s.transferred_at
        FROM attendance_records r
        INNER JOIN attendance_sheets s ON s.id = r.sheet_id
        ${whereSql}
      `)
      .all(...params);

    const records = rows.map((row) => ({
      id: row.id,
      sheetId: row.sheet_id,
      clientSheetId: row.client_sheet_id,
      sheetTitle: row.sheet_title,
      rollNumber: row.roll_number,
      studentName: row.student_name,
      status: row.status,
      time: row.marked_time || row.attendance_time,
      date: row.attendance_date,
      sheetTime: row.attendance_time,
      subject: row.subject,
      className: row.class_name,
      facultyName: row.faculty_name,
      transferMethod: row.transfer_method,
      sourceDevice: row.source_device,
      transferredAt: row.transferred_at,
      remarks: row.remarks,
    }));

    const sortBy = filters.sortBy || 'date';
    const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;

    records.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'roll_number':
        case 'rollNumber':
          cmp = naturalCompare(a.rollNumber, b.rollNumber);
          break;
        case 'student_name':
        case 'studentName':
          cmp = a.studentName.localeCompare(b.studentName, undefined, { sensitivity: 'base' });
          break;
        case 'time':
          cmp = a.time.localeCompare(b.time);
          break;
        case 'subject':
          cmp = a.subject.localeCompare(b.subject, undefined, { sensitivity: 'base' });
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'date':
        default:
          cmp = a.date.localeCompare(b.date);
          break;
      }
      if (cmp !== 0) return cmp * sortDir;

      // Deterministic tie-breakers
      const dateCmp = a.date.localeCompare(b.date) * sortDir;
      if (dateCmp !== 0) return dateCmp;
      const timeCmp = a.time.localeCompare(b.time) * sortDir;
      if (timeCmp !== 0) return timeCmp;
      return naturalCompare(a.rollNumber, b.rollNumber);
    });

    const summary = computeStats(records);
    const presentees = records.filter((r) => r.status === 'Present');
    const absentees = records.filter((r) => r.status === 'Absent');

    const distinctDates = db
      .prepare('SELECT DISTINCT attendance_date AS val FROM attendance_sheets ORDER BY attendance_date DESC')
      .all()
      .map((x) => x.val);
    const distinctSubjects = db
      .prepare('SELECT DISTINCT subject AS val FROM attendance_sheets ORDER BY LOWER(subject) ASC')
      .all()
      .map((x) => x.val);
    const distinctFaculties = db
      .prepare('SELECT DISTINCT faculty_name AS val FROM attendance_sheets ORDER BY LOWER(faculty_name) ASC')
      .all()
      .map((x) => x.val);

    return {
      records,
      summary,
      presentees,
      absentees,
      availableFilters: {
        dates: distinctDates,
        subjects: distinctSubjects,
        faculties: distinctFaculties,
      },
    };
  }

  function getAnalytics(filters = {}) {
    const where = [];
    const params = [];

    if (filters.subject) {
      where.push('LOWER(s.subject) = LOWER(?)');
      params.push(filters.subject);
    }
    if (filters.dateFrom) {
      where.push('s.attendance_date >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.push('s.attendance_date <= ?');
      params.push(filters.dateTo);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT
          r.roll_number,
          r.student_name,
          r.status,
          s.id AS sheet_id,
          s.subject,
          s.attendance_date
        FROM attendance_records r
        INNER JOIN attendance_sheets s ON s.id = r.sheet_id
        ${whereSql}
      `)
      .all(...params);

    const sheetIds = new Set();
    const subjectSet = new Set();
    const dateSet = new Set();
    const studentMap = new Map();
    const dateMap = new Map();
    const subjectMap = new Map();

    let totalPresent = 0;
    let totalAbsent = 0;

    for (const row of rows) {
      sheetIds.add(row.sheet_id);
      subjectSet.add(row.subject);
      dateSet.add(row.attendance_date);
      const isPresent = row.status === 'Present';
      if (isPresent) totalPresent += 1;
      else totalAbsent += 1;

      // Date aggregation
      if (!dateMap.has(row.attendance_date)) {
        dateMap.set(row.attendance_date, {
          date: row.attendance_date,
          total: 0,
          present: 0,
          absent: 0,
          sheetIds: new Set(),
        });
      }
      const dEntry = dateMap.get(row.attendance_date);
      dEntry.total += 1;
      if (isPresent) dEntry.present += 1;
      else dEntry.absent += 1;
      dEntry.sheetIds.add(row.sheet_id);

      // Subject aggregation
      if (!subjectMap.has(row.subject)) {
        subjectMap.set(row.subject, {
          subject: row.subject,
          total: 0,
          present: 0,
          absent: 0,
          sheetIds: new Set(),
        });
      }
      const sEntry = subjectMap.get(row.subject);
      sEntry.total += 1;
      if (isPresent) sEntry.present += 1;
      else sEntry.absent += 1;
      sEntry.sheetIds.add(row.sheet_id);

      // Student aggregation
      const rollKey = row.roll_number.trim().toLowerCase();
      if (!studentMap.has(rollKey)) {
        studentMap.set(rollKey, {
          rollNumber: row.roll_number,
          studentName: row.student_name,
          totalClasses: 0,
          presentCount: 0,
          absentCount: 0,
        });
      }
      const stEntry = studentMap.get(rollKey);
      stEntry.totalClasses += 1;
      if (isPresent) stEntry.presentCount += 1;
      else stEntry.absentCount += 1;
    }

    const totalEntries = rows.length;
    const overallPercentage = totalEntries > 0 ? Number(((totalPresent / totalEntries) * 100).toFixed(1)) : 0;

    const byDate = Array.from(dateMap.values())
      .map((d) => ({
        date: d.date,
        total: d.total,
        present: d.present,
        absent: d.absent,
        sheetsCount: d.sheetIds.size,
        percentage: d.total > 0 ? Number(((d.present / d.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const bySubject = Array.from(subjectMap.values())
      .map((s) => ({
        subject: s.subject,
        total: s.total,
        present: s.present,
        absent: s.absent,
        sessions: s.sheetIds.size,
        percentage: s.total > 0 ? Number(((s.present / s.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: 'base' }));

    const byStudent = Array.from(studentMap.values())
      .map((st) => {
        const percentage = st.totalClasses > 0 ? Number(((st.presentCount / st.totalClasses) * 100).toFixed(1)) : 0;
        return {
          ...st,
          percentage,
          lowAttendance: percentage < 75,
        };
      })
      .sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber));

    return {
      overall: {
        totalSheets: sheetIds.size,
        totalEntries,
        totalPresent,
        totalAbsent,
        overallPercentage,
        uniqueStudents: byStudent.length,
        uniqueSubjects: subjectSet.size,
        uniqueDates: dateSet.size,
      },
      byDate,
      bySubject,
      byStudent,
    };
  }

  function getHealthStats() {
    const row = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM attendance_sheets) AS total_sheets,
          (SELECT COUNT(*) FROM attendance_records) AS total_records
      `)
      .get();
    return {
      totalSheets: Number(row.total_sheets || 0),
      totalRecords: Number(row.total_records || 0),
    };
  }

  function close() {
    db.close();
  }

  return {
    upsertSheet,
    listSheets,
    getSheetById,
    deleteSheet,
    queryAttendance,
    getAnalytics,
    getHealthStats,
    close,
  };
}

module.exports = {
  createDatabase,
};
