package com.school.mobileattendance.transfer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.school.mobileattendance.data.AttendanceSheet
import com.school.mobileattendance.data.TransferResult
import java.io.File
import java.util.UUID

object BluetoothTransferManager {

    // Standard Serial Port Profile (SPP) RFCOMM UUID matching server/bluetooth_receiver.py
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @SuppressLint("MissingPermission")
    fun getPairedDevices(context: Context): List<BluetoothDevice> {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter: BluetoothAdapter = manager?.adapter ?: return emptyList()
        if (!adapter.isEnabled) return emptyList()
        return adapter.bondedDevices?.toList().orEmpty()
    }

    @SuppressLint("MissingPermission")
    fun sendViaRfcommSocket(device: BluetoothDevice, sheet: AttendanceSheet): TransferResult {
        val payload = InternetTransferClient.buildPayloadJson(sheet, "bluetooth").toString(2)
        val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
        return try {
            socket.connect()
            socket.outputStream.use { out ->
                out.write(payload.toByteArray(Charsets.UTF_8))
                out.flush()
            }
            TransferResult(true, "Sent via Bluetooth to ${device.name ?: device.address}")
        } catch (e: Exception) {
            TransferResult(false, "Bluetooth RFCOMM failed: ${e.message}")
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    fun exportSheetFile(context: Context, sheet: AttendanceSheet, asCsv: Boolean = false): File {
        val exportDir = File(context.filesDir, "exports").apply { mkdirs() }
        val safeName = "${sheet.subject}-${sheet.date}".lowercase().replace(Regex("[^a-z0-9]+"), "-")
        val ext = if (asCsv) "csv" else "json"
        val file = File(exportDir, "attendance-$safeName.$ext")

        if (asCsv) {
            val sb = StringBuilder("Roll Number,Student Name,Status,Subject,Class,Faculty,Date,Time\r\n")
            for (rec in sheet.records) {
                sb.append(
                    listOf(
                        rec.rollNumber,
                        rec.studentName,
                        rec.status,
                        sheet.subject,
                        sheet.className,
                        sheet.facultyName,
                        sheet.date,
                        rec.markedTime
                    ).joinToString(",") { cell ->
                        if (cell.contains(",") || cell.contains("\"")) {
                            "\"${cell.replace("\"", "\"\"")}\""
                        } else {
                            cell
                        }
                    }
                ).append("\r\n")
            }
            file.writeText(sb.toString(), Charsets.UTF_8)
        } else {
            val json = InternetTransferClient.buildPayloadJson(sheet, "bluetooth").toString(2)
            file.writeText(json, Charsets.UTF_8)
        }

        return file
    }

    fun createBluetoothShareIntent(context: Context, file: File): Intent {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
        val mime = if (file.extension == "csv") "text/csv" else "application/json"
        return Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Attendance Sheet: ${file.name}")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
