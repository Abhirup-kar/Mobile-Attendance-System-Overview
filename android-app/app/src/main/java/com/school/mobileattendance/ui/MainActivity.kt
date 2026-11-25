package com.school.mobileattendance.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.school.mobileattendance.R
import com.school.mobileattendance.data.AttendanceDbHelper
import com.school.mobileattendance.data.AttendanceSheet
import com.school.mobileattendance.transfer.BluetoothTransferManager
import com.school.mobileattendance.transfer.InternetTransferClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var dbHelper: AttendanceDbHelper
    private lateinit var recyclerView: RecyclerView
    private lateinit var emptyText: TextView
    private lateinit var serverUrlInput: EditText
    private val sheets = mutableListOf<AttendanceSheet>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        dbHelper = AttendanceDbHelper(this)
        recyclerView = findViewById(R.id.recyclerSheets)
        emptyText = findViewById(R.id.textEmptySheets)
        serverUrlInput = findViewById(R.id.editServerUrl)

        val prefs = getSharedPreferences("mas_prefs", MODE_PRIVATE)
        serverUrlInput.setText(prefs.getString("server_url", "http://10.0.2.2:3000"))

        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = SheetAdapter()

        findViewById<Button>(R.id.btnCreateSheet).setOnClickListener {
            startActivity(Intent(this, CreateSheetActivity::class.java))
        }

        findViewById<Button>(R.id.btnTestServer).setOnClickListener {
            val url = serverUrlInput.text.toString().trim()
            prefs.edit().putString("server_url", url).apply()
            CoroutineScope(Dispatchers.IO).launch {
                val res = InternetTransferClient.checkHealth(url)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshSheets()
    }

    private fun refreshSheets() {
        sheets.clear()
        sheets.addAll(dbHelper.getAllSheets())
        recyclerView.adapter?.notifyDataSetChanged()
        emptyText.visibility = if (sheets.isEmpty()) View.VISIBLE else View.GONE
    }

    private inner class SheetAdapter : RecyclerView.Adapter<SheetViewHolder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SheetViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_sheet, parent, false)
            return SheetViewHolder(v)
        }

        override fun getItemCount(): Int = sheets.size

        override fun onBindViewHolder(holder: SheetViewHolder, position: Int) {
            holder.bind(sheets[position])
        }
    }

    private inner class SheetViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val titleText: TextView = view.findViewById(R.id.textSheetSubject)
        private val metaText: TextView = view.findViewById(R.id.textSheetMeta)
        private val statsText: TextView = view.findViewById(R.id.textSheetStats)
        private val btnMark: Button = view.findViewById(R.id.btnRowMark)
        private val btnView: Button = view.findViewById(R.id.btnRowView)
        private val btnInternet: Button = view.findViewById(R.id.btnRowInternet)
        private val btnBluetooth: Button = view.findViewById(R.id.btnRowBluetooth)

        fun bind(sheet: AttendanceSheet) {
            titleText.text = "${sheet.subject} (${sheet.date})"
            metaText.text = "${sheet.className.ifEmpty { "Class" }} • ${sheet.facultyName} • ${sheet.transferStatus.uppercase()}"
            statsText.text = "Present: ${sheet.presentCount()} | Absent: ${sheet.absentCount()} | Total: ${sheet.records.size}"

            btnMark.setOnClickListener {
                startActivity(Intent(this@MainActivity, MarkAttendanceActivity::class.java).putExtra("sheet_id", sheet.id))
            }
            btnView.setOnClickListener {
                startActivity(Intent(this@MainActivity, ViewSheetActivity::class.java).putExtra("sheet_id", sheet.id))
            }
            btnInternet.setOnClickListener {
                val url = serverUrlInput.text.toString().trim()
                getSharedPreferences("mas_prefs", MODE_PRIVATE).edit().putString("server_url", url).apply()
                CoroutineScope(Dispatchers.IO).launch {
                    val result = InternetTransferClient.sendSheet(url, sheet)
                    if (result.success) {
                        val nowIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date())
                        dbHelper.markTransferred(sheet.id, "internet", nowIso)
                    }
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, result.message, Toast.LENGTH_LONG).show()
                        refreshSheets()
                    }
                }
            }
            btnBluetooth.setOnClickListener {
                val file = BluetoothTransferManager.exportSheetFile(this@MainActivity, sheet, asCsv = false)
                val shareIntent = BluetoothTransferManager.createBluetoothShareIntent(this@MainActivity, file)
                startActivity(Intent.createChooser(shareIntent, "Transfer Attendance via Bluetooth"))
            }
        }
    }
}
