# Mobile Attendance System

An end-to-end **Mobile Attendance System** designed for schools and colleges to eliminate paper-based attendance tracking and manual reporting. It covers every module from the system specification:

1. **Android Mobile App (Faculty)**
   - **Offline-First Android PWA** served at `/mobile` (installable on Android Chrome via *Add to Home Screen*, backed by `IndexedDB` + Service Worker).
   - **Native Android SDK Project** (`android-app/`, Kotlin + Material XML + Android `SQLiteOpenHelper` + `InternetTransferClient` + `BluetoothTransferManager`).
2. **Student Attendance List Creation**
   - Create sheets with **Student Name, Roll Number, Date, Absent/Present mark, and Subject** (plus Class/Section and Faculty Name).
   - Supports single-student entry, bulk paste (`Roll, Name`), reusable class rosters, and a 12-student sample class.
3. **Attendance Marking**
   - Standard roll-ordered list with one-tap **Present / Absent** buttons capturing exact timestamps, plus **Roll-Call Mode** (one student at a time with auto-advance).
4. **Attendance Storage (Phone Memory)**
   - Persisted locally in phone storage (`IndexedDB` in the PWA, `SQLiteOpenHelper` `mobile_attendance.db` in the native Android app) so faculty can view or edit sheets anytime offline.
5. **Attendance Sheet Transfer (Internet & Bluetooth)**
   - **Internet Transfer**: Direct HTTP JSON sync (`POST /api/transfers`) from the Android phone to the PC Server over Wi-Fi / LAN / Internet.
   - **Bluetooth Transfer**: Android Bluetooth Share / RFCOMM export (`.json` or `.csv`) + PC ingestion via `server/bluetooth_receiver.py` or the PC Operator Portal's drag-and-drop importer.
6. **Attendance Check & Overall Class Performance (PC Server & Operator Portal)**
   - Filter by **Student Roll No, Name, Subject, Status, Transfer Method, and Particular Date**.
   - **Sort by Date**, Roll Number, Time, Student Name, Subject, or Status.
   - Side-by-side **Presentees & Absentees** breakdown for any selected date.
   - **Class Performance Analytics**: overall attendance %, date-wise SVG trend chart, subject-wise bars, and student-wise standing with `< 75%` low-attendance alerts.

---

## Quick Start

### Prerequisites
- **Node.js >= 22.5** (uses built-in `node:sqlite`, `node:test`, and `node:http` — **zero external npm packages required**).
- **Python 3** (optional, for `server/bluetooth_receiver.py`).
- **Android Studio / JDK 17 + Android SDK 34** (only needed if compiling the native Kotlin APK in `android-app/`).

### 1. Start the PC Server & Operator Portal
```bash
npm start
```
The server prints:
- **PC Operator Portal**: `http://localhost:3000/`
- **Mobile Faculty App (PWA)**: `http://localhost:3000/mobile`
- **LAN URLs** (e.g., `http://192.168.x.x:3000/mobile`) so an Android phone on the same Wi-Fi can open and install the app directly.

### 2. Optional: Seed Sample Data
```bash
npm run seed
```
Or click **Load Sample Data** inside the PC Operator Portal header.

### 3. Run Automated Tests
```bash
npm test
```

---

## Bluetooth Transfer Workflow

1. On the Android Faculty App (**Transfer** tab), export an attendance sheet as **Bluetooth JSON** or **Bluetooth CSV** (uses Android Share Sheet to send over Bluetooth to the PC, or `BluetoothTransferManager` in the native Android app).
2. On the PC, ingest the received file using any of these options:
   - **PC Operator Portal UI**: Open **Import Bluetooth / File** tab and drag-and-drop the `.json` or `.csv` file.
   - **One-shot CLI**:
     ```bash
     python3 server/bluetooth_receiver.py --file path/to/attendance.json
     ```
   - **Auto-watch Bluetooth Downloads Folder**:
     ```bash
     python3 server/bluetooth_receiver.py --mode watch --watch-dir ~/Downloads
     ```
   - **Direct Linux Bluetooth RFCOMM Listener**:
     ```bash
     python3 server/bluetooth_receiver.py --mode bluetooth --channel 1
     ```

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Server health and total sheet/record counts |
| `POST` | `/api/transfers` | Upsert an attendance sheet JSON payload from mobile app |
| `POST` | `/api/transfers/upload` | Ingest exported `.json` or `.csv` file (Bluetooth / File Import) |
| `GET` | `/api/sheets` | List transferred sheets with Present/Absent counts |
| `GET` | `/api/sheets/:id` | Get full sheet details and student records |
| `DELETE` | `/api/sheets/:id` | Delete a sheet and its records |
| `GET` | `/api/attendance` | Query records (`date`, `subject`, `rollNumber`, `search`, `status`, `sortBy`, `sortDir`) + `presentees` & `absentees` |
| `GET` | `/api/attendance/export` | Download filtered attendance records as CSV |
| `GET` | `/api/analytics` | Overall, date-wise, subject-wise, and student-wise class performance |
| `POST` | `/api/demo/seed` | Idempotently seed 6 sample attendance sheets |
