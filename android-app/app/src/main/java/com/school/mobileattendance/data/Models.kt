package com.school.mobileattendance.data

data class StudentAttendanceRecord(
    val id: Long = 0,
    val sheetId: Long = 0,
    val rollNumber: String,
    val studentName: String,
    var status: String, // "Present" | "Absent"
    var markedTime: String
)

data class AttendanceSheet(
    val id: Long = 0,
    val clientSheetId: String,
    val subject: String,
    val className: String,
    val facultyName: String,
    val date: String, // YYYY-MM-DD
    val time: String, // HH:MM:SS
    var transferStatus: String = "local", // "local" | "transferred" | "modified"
    var transferMethod: String = "internet",
    var transferredAt: String? = null,
    val records: MutableList<StudentAttendanceRecord> = mutableListOf()
) {
    fun presentCount(): Int = records.count { it.status == "Present" }
    fun absentCount(): Int = records.count { it.status == "Absent" }
}

data class TransferResult(
    val success: Boolean,
    val message: String
)
