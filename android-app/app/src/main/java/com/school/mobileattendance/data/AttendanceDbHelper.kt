package com.school.mobileattendance.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AttendanceDbHelper(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "mobile_attendance.db"
        private const val DATABASE_VERSION = 1

        private const val TABLE_SHEETS = "sheets"
        private const val TABLE_RECORDS = "records"
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $TABLE_SHEETS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_sheet_id TEXT UNIQUE NOT NULL,
                subject TEXT NOT NULL,
                class_name TEXT NOT NULL DEFAULT '',
                faculty_name TEXT NOT NULL DEFAULT 'Faculty',
                attendance_date TEXT NOT NULL,
                attendance_time TEXT NOT NULL,
                transfer_status TEXT NOT NULL DEFAULT 'local',
                transfer_method TEXT NOT NULL DEFAULT 'internet',
                transferred_at TEXT
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE $TABLE_RECORDS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sheet_id INTEGER NOT NULL REFERENCES $TABLE_SHEETS(id) ON DELETE CASCADE,
                roll_number TEXT NOT NULL,
                student_name TEXT NOT NULL,
                status TEXT NOT NULL,
                marked_time TEXT NOT NULL,
                UNIQUE(sheet_id, roll_number)
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_RECORDS")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_SHEETS")
        onCreate(db)
    }

    fun saveSheet(sheet: AttendanceSheet): Long {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val values = ContentValues().apply {
                put("client_sheet_id", sheet.clientSheetId)
                put("subject", sheet.subject)
                put("class_name", sheet.className)
                put("faculty_name", sheet.facultyName)
                put("attendance_date", sheet.date)
                put("attendance_time", sheet.time)
                put("transfer_status", sheet.transferStatus)
                put("transfer_method", sheet.transferMethod)
                put("transferred_at", sheet.transferredAt)
            }

            val sheetId = db.insertWithOnConflict(
                TABLE_SHEETS,
                null,
                values,
                SQLiteDatabase.CONFLICT_REPLACE
            )

            db.delete(TABLE_RECORDS, "sheet_id = ?", arrayOf(sheetId.toString()))
            for (rec in sheet.records) {
                val rValues = ContentValues().apply {
                    put("sheet_id", sheetId)
                    put("roll_number", rec.rollNumber)
                    put("student_name", rec.studentName)
                    put("status", rec.status)
                    put("marked_time", rec.markedTime)
                }
                db.insert(TABLE_RECORDS, null, rValues)
            }

            db.setTransactionSuccessful()
            return sheetId
        } finally {
            db.endTransaction()
        }
    }

    fun getAllSheets(): List<AttendanceSheet> {
        val db = readableDatabase
        val result = mutableListOf<AttendanceSheet>()
        db.rawQuery(
            "SELECT * FROM $TABLE_SHEETS ORDER BY attendance_date DESC, attendance_time DESC, id DESC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(cursor.getColumnIndexOrThrow("id"))
                val records = getRecordsForSheet(db, id)
                result.add(
                    AttendanceSheet(
                        id = id,
                        clientSheetId = cursor.getString(cursor.getColumnIndexOrThrow("client_sheet_id")),
                        subject = cursor.getString(cursor.getColumnIndexOrThrow("subject")),
                        className = cursor.getString(cursor.getColumnIndexOrThrow("class_name")),
                        facultyName = cursor.getString(cursor.getColumnIndexOrThrow("faculty_name")),
                        date = cursor.getString(cursor.getColumnIndexOrThrow("attendance_date")),
                        time = cursor.getString(cursor.getColumnIndexOrThrow("attendance_time")),
                        transferStatus = cursor.getString(cursor.getColumnIndexOrThrow("transfer_status")),
                        transferMethod = cursor.getString(cursor.getColumnIndexOrThrow("transfer_method")),
                        transferredAt = cursor.getString(cursor.getColumnIndexOrThrow("transferred_at")),
                        records = records.toMutableList()
                    )
                )
            }
        }
        return result
    }

    fun getSheetById(sheetId: Long): AttendanceSheet? {
        val db = readableDatabase
        db.rawQuery("SELECT * FROM $TABLE_SHEETS WHERE id = ?", arrayOf(sheetId.toString())).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val records = getRecordsForSheet(db, sheetId)
            return AttendanceSheet(
                id = sheetId,
                clientSheetId = cursor.getString(cursor.getColumnIndexOrThrow("client_sheet_id")),
                subject = cursor.getString(cursor.getColumnIndexOrThrow("subject")),
                className = cursor.getString(cursor.getColumnIndexOrThrow("class_name")),
                facultyName = cursor.getString(cursor.getColumnIndexOrThrow("faculty_name")),
                date = cursor.getString(cursor.getColumnIndexOrThrow("attendance_date")),
                time = cursor.getString(cursor.getColumnIndexOrThrow("attendance_time")),
                transferStatus = cursor.getString(cursor.getColumnIndexOrThrow("transfer_status")),
                transferMethod = cursor.getString(cursor.getColumnIndexOrThrow("transfer_method")),
                transferredAt = cursor.getString(cursor.getColumnIndexOrThrow("transferred_at")),
                records = records.toMutableList()
            )
        }
    }

    private fun getRecordsForSheet(db: SQLiteDatabase, sheetId: Long): List<StudentAttendanceRecord> {
        val list = mutableListOf<StudentAttendanceRecord>()
        db.rawQuery(
            "SELECT * FROM $TABLE_RECORDS WHERE sheet_id = ? ORDER BY roll_number ASC",
            arrayOf(sheetId.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                list.add(
                    StudentAttendanceRecord(
                        id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
                        sheetId = sheetId,
                        rollNumber = cursor.getString(cursor.getColumnIndexOrThrow("roll_number")),
                        studentName = cursor.getString(cursor.getColumnIndexOrThrow("student_name")),
                        status = cursor.getString(cursor.getColumnIndexOrThrow("status")),
                        markedTime = cursor.getString(cursor.getColumnIndexOrThrow("marked_time"))
                    )
                )
            }
        }
        return list
    }

    fun updateRecordStatus(sheetId: Long, rollNumber: String, status: String, markedTime: String) {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("status", status)
            put("marked_time", markedTime)
        }
        db.update(
            TABLE_RECORDS,
            values,
            "sheet_id = ? AND roll_number = ?",
            arrayOf(sheetId.toString(), rollNumber)
        )
    }

    fun markTransferred(sheetId: Long, method: String, transferredAtIso: String) {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("transfer_status", "transferred")
            put("transfer_method", method)
            put("transferred_at", transferredAtIso)
        }
        db.update(TABLE_SHEETS, values, "id = ?", arrayOf(sheetId.toString()))
    }

    fun deleteSheet(sheetId: Long) {
        writableDatabase.delete(TABLE_SHEETS, "id = ?", arrayOf(sheetId.toString()))
    }
}
