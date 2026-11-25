package com.school.mobileattendance.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.school.mobileattendance.R
import com.school.mobileattendance.data.AttendanceDbHelper
import com.school.mobileattendance.data.AttendanceSheet
import com.school.mobileattendance.data.StudentAttendanceRecord
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MarkAttendanceActivity : AppCompatActivity() {

    private lateinit var dbHelper: AttendanceDbHelper
    private var sheet: AttendanceSheet? = null
    private lateinit var headerText: TextView
    private lateinit var summaryText: TextView
    private lateinit var recyclerView: RecyclerView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_mark_attendance)

        dbHelper = AttendanceDbHelper(this)
        headerText = findViewById(R.id.textMarkHeader)
        summaryText = findViewById(R.id.textMarkSummary)
        recyclerView = findViewById(R.id.recyclerMarkStudents)

        val sheetId = intent.getLongExtra("sheet_id", -1L)
        sheet = dbHelper.getSheetById(sheetId)
        if (sheet == null) {
            Toast.makeText(this, "Attendance sheet not found", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        headerText.text = "${sheet!!.subject} • ${sheet!!.date}"
        updateSummary()

        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = StudentMarkAdapter(sheet!!.records)

        findViewById<Button>(R.id.btnDoneMarking).setOnClickListener {
            Toast.makeText(this, "Attendance saved in phone memory", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun updateSummary() {
        val s = sheet ?: return
        summaryText.text = "Present: ${s.presentCount()} | Absent: ${s.absentCount()} | Total: ${s.records.size}"
    }

    private inner class StudentMarkAdapter(
        private val items: List<StudentAttendanceRecord>
    ) : RecyclerView.Adapter<StudentMarkVH>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): StudentMarkVH {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_student_mark, parent, false)
            return StudentMarkVH(v)
        }

        override fun getItemCount(): Int = items.size

        override fun onBindViewHolder(holder: StudentMarkVH, position: Int) {
            holder.bind(items[position])
        }
    }

    private inner class StudentMarkVH(view: View) : RecyclerView.ViewHolder(view) {
        private val label: TextView = view.findViewById(R.id.textStudentLabel)
        private val statusText: TextView = view.findViewById(R.id.textStudentStatus)
        private val btnPresent: Button = view.findViewById(R.id.btnMarkPresent)
        private val btnAbsent: Button = view.findViewById(R.id.btnMarkAbsent)

        fun bind(rec: StudentAttendanceRecord) {
            label.text = "Roll ${rec.rollNumber} — ${rec.studentName}"
            statusText.text = "Status: ${rec.status} (${rec.markedTime})"

            btnPresent.setOnClickListener { setStatus(rec, "Present") }
            btnAbsent.setOnClickListener { setStatus(rec, "Absent") }
        }

        private fun setStatus(rec: StudentAttendanceRecord, newStatus: String) {
            val now = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
            rec.status = newStatus
            rec.markedTime = now
            sheet?.let {
                dbHelper.updateRecordStatus(it.id, rec.rollNumber, newStatus, now)
            }
            statusText.text = "Status: ${rec.status} (${rec.markedTime})"
            updateSummary()
        }
    }
}
