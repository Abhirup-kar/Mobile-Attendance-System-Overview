package com.school.mobileattendance.transfer

import android.os.Build
import com.school.mobileattendance.data.AttendanceSheet
import com.school.mobileattendance.data.TransferResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object InternetTransferClient {

    fun buildPayloadJson(sheet: AttendanceSheet, transferMethod: String = "internet"): JSONObject {
        val recordsArr = JSONArray()
        for (rec in sheet.records) {
            recordsArr.put(
                JSONObject().apply {
                    put("rollNumber", rec.rollNumber)
                    put("studentName", rec.studentName)
                    put("status", rec.status)
                    put("markedTime", rec.markedTime)
                }
            )
        }

        return JSONObject().apply {
            put("clientSheetId", sheet.clientSheetId)
            put("title", "${sheet.subject} (${sheet.date})")
            put("subject", sheet.subject)
            put("className", sheet.className)
            put("facultyName", sheet.facultyName)
            put("date", sheet.date)
            put("time", sheet.time)
            put("transferMethod", transferMethod)
            put("sourceDevice", "${Build.MANUFACTURER} ${Build.MODEL} (Android SDK)")
            put("records", recordsArr)
        }
    }

    fun sendSheet(serverBaseUrl: String, sheet: AttendanceSheet): TransferResult {
        val cleanUrl = serverBaseUrl.trim().trimEnd('/')
        val endpoint = URL("$cleanUrl/api/transfers")
        val conn = (endpoint.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }

        return try {
            val payload = buildPayloadJson(sheet, "internet").toString()
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload)
                writer.flush()
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
            }.orEmpty()

            if (code in 200..299) {
                TransferResult(true, "Transferred to PC Server (HTTP $code)")
            } else {
                TransferResult(false, "Server error $code: $body")
            }
        } catch (e: Exception) {
            TransferResult(false, "Network error: ${e.message ?: "Unable to connect"}")
        } finally {
            conn.disconnect()
        }
    }

    fun checkHealth(serverBaseUrl: String): TransferResult {
        val cleanUrl = serverBaseUrl.trim().trimEnd('/')
        val conn = (URL("$cleanUrl/api/health").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5000
            readTimeout = 5000
        }
        return try {
            val code = conn.responseCode
            if (code == 200) TransferResult(true, "Connected to PC Server")
            else TransferResult(false, "Health check returned HTTP $code")
        } catch (e: Exception) {
            TransferResult(false, e.message ?: "Unreachable")
        } finally {
            conn.disconnect()
        }
    }
}
