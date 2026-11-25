package com.school.mobileattendance.ui

import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.school.mobileattendance.R
import com.school.mobileattendance.data.AttendanceDbHelper

class ViewSheetActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_view_sheet)

        val sheetId = intent.getLongExtra("sheet_id", -1L)
        val dbHelper = AttendanceDbHelper(this)
        val sheet = dbHelper.getSheetById(sheetId)
        if (sheet == null) {
            Toast.makeText(this, "Sheet not found", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        findViewById<TextView>(R.id.textViewTitle).text = "${sheet.subject} (${sheet.date})"
        findViewById<TextView>(R.id.textViewSubtitle).text =
            "Class: ${sheet.className.ifEmpty { "-" }} • Faculty: ${sheet.facultyName}\nPresent: ${sheet.presentCount()} | Absent: ${sheet.absentCount()} | Total: ${sheet.records.size}"

        val lines = sheet.records.joinToString("\n") {
            "Roll ${it.rollNumber} | ${it.studentName} — ${it.status} (${it.markedTime})"
        }
        findViewById<TextView>(R.id.textViewRecords).text = lines
    }
}
