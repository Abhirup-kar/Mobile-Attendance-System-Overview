package com.school.mobileattendance.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.school.mobileattendance.R
import com.school.mobileattendance.data.AttendanceDbHelper
import com.school.mobileattendance.data.AttendanceSheet
import com.school.mobileattendance.data.StudentAttendanceRecord
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class CreateSheetActivity : AppCompatActivity() {

    private val draftStudents = mutableListOf<Pair<String, String>>()
    private lateinit var dbHelper: AttendanceDbHelper
    private lateinit var draftPreview: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_create_sheet)
        dbHelper = AttendanceDbHelper(this)

        val editSubject = findViewById<EditText>(R.id.editSubject)
        val editClass = findViewById<EditText>(R.id.editClassName)
        val editFaculty = findViewById<EditText>(R.id.editFacultyName)
        val editDate = findViewById<EditText>(R.id.editDate)
        val editRoll = findViewById<EditText>(R.id.editRollNumber)
        val editName = findViewById<EditText>(R.id.editStudentName)
        draftPreview = findViewById(R.id.textDraftStudents)

        editDate.setText(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))

        findViewById<Button>(R.id.btnAddStudent).setOnClickListener {
            val roll = editRoll.text.toString().trim()
            val name = editName.text.toString().trim()
            if (roll.isEmpty() || name.isEmpty()) {
                Toast.makeText(this, "Enter both roll number and student name", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (draftStudents.any { it.first.equals(roll, ignoreCase = true) }) {
                Toast.makeText(this, "Roll $roll already exists", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            draftStudents.add(roll to name)
            editRoll.text.clear()
            editName.text.clear()
            renderDraft()
        }

        findViewById<Button>(R.id.btnLoadSample).setOnClickListener {
            val sample = listOf(
                "101" to "Aarav Patel",
                "102" to "Diya Sharma",
                "103" to "Rohan Verma",
                "104" to "Ananya Nair",
                "105" to "Kabir Mehta"
            )
            for (s in sample) {
                if (draftStudents.none { it.first == s.first }) draftStudents.add(s)
            }
            renderDraft()
        }

        findViewById<Button>(R.id.btnSaveSheet).setOnClickListener {
            val subject = editSubject.text.toString().trim()
            val date = editDate.text.toString().trim()
            if (subject.isEmpty() || date.isEmpty() || draftStudents.isEmpty()) {
                Toast.makeText(this, "Subject, date, and at least one student are required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val timeNow = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
            val sheet = AttendanceSheet(
                clientSheetId = UUID.randomUUID().toString(),
                subject = subject,
                className = editClass.text.toString().trim(),
                facultyName = editFaculty.text.toString().trim().ifEmpty { "Faculty" },
                date = date,
                time = timeNow,
                records = draftStudents.map { (roll, name) ->
                    StudentAttendanceRecord(
                        rollNumber = roll,
                        studentName = name,
                        status = "Present",
                        markedTime = timeNow
                    )
                }.toMutableList()
            )

            val savedId = dbHelper.saveSheet(sheet)
            startActivity(Intent(this, MarkAttendanceActivity::class.java).putExtra("sheet_id", savedId))
            finish()
        }
    }

    private fun renderDraft() {
        draftPreview.text = if (draftStudents.isEmpty()) {
            "No students added yet."
        } else {
            draftStudents.joinToString("\n") { "${it.first} — ${it.second}" }
        }
    }
}
