(function () {
  'use strict';

  const U = window.AttendanceUtils;
  const DB_NAME = 'MobileAttendanceDB';
  const DB_VERSION = 1;
  const FALLBACK_SHEETS_KEY = 'mas_fallback_sheets_v1';
  const FALLBACK_ROSTERS_KEY = 'mas_fallback_rosters_v1';
  const SERVER_URL_KEY = 'mas_server_url_v1';
  const FACULTY_NAME_KEY = 'mas_faculty_name_v1';

  const SAMPLE_CLASS_STUDENTS = [
    { rollNumber: '101', studentName: 'Aarav Patel' },
    { rollNumber: '102', studentName: 'Diya Sharma' },
    { rollNumber: '103', studentName: 'Rohan Verma' },
    { rollNumber: '104', studentName: 'Ananya Nair' },
    { rollNumber: '105', studentName: 'Kabir Mehta' },
    { rollNumber: '106', studentName: 'Priya Iyer' },
    { rollNumber: '107', studentName: 'Vikram Singh' },
    { rollNumber: '108', studentName: 'Sneha Kulkarni' },
    { rollNumber: '109', studentName: 'Arjun Reddy' },
    { rollNumber: '110', studentName: 'Meera Joshi' },
    { rollNumber: '111', studentName: 'Siddharth Rao' },
    { rollNumber: '112', studentName: 'Neha Deshmukh' },
  ];

  // Local Phone Storage wrapper (IndexedDB with localStorage fallback)
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sheets')) {
          db.createObjectStore('sheets', { keyPath: 'clientSheetId' });
        }
        if (!db.objectStoreNames.contains('rosters')) {
          db.createObjectStore('rosters', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGetAll(storeName, fallbackKey) {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      try {
        return JSON.parse(localStorage.getItem(fallbackKey) || '[]');
      } catch (__) {
        return [];
      }
    }
  }

  async function idbPut(storeName, item, keyProp, fallbackKey) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const list = JSON.parse(localStorage.getItem(fallbackKey) || '[]');
      const idx = list.findIndex((x) => x[keyProp] === item[keyProp]);
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      localStorage.setItem(fallbackKey, JSON.stringify(list));
    }
  }

  async function idbDelete(storeName, key, keyProp, fallbackKey) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const list = JSON.parse(localStorage.getItem(fallbackKey) || '[]');
      localStorage.setItem(fallbackKey, JSON.stringify(list.filter((x) => x[keyProp] !== key)));
    }
  }

  // App State
  const state = {
    activeTab: 'sheets',
    sheets: [],
    rosters: [],
    draftStudents: [],
    activeSheetId: null,
    rollCallMode: false,
    rollCallIndex: 0,
  };

  function getServerUrl() {
    const saved = localStorage.getItem(SERVER_URL_KEY);
    if (saved) return saved.replace(/\/+$/, '');
    return window.location.origin;
  }

  function setServerUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    localStorage.setItem(SERVER_URL_KEY, clean || window.location.origin);
  }

  function computeSheetCounts(sheet) {
    const records = sheet.records || [];
    let present = 0;
    let absent = 0;
    let unmarked = 0;
    for (const r of records) {
      if (r.status === 'Present') present += 1;
      else if (r.status === 'Absent') absent += 1;
      else unmarked += 1;
    }
    const total = records.length;
    const marked = present + absent;
    const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';
    return { total, present, absent, unmarked, marked, percentage };
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.mobile-view').forEach((el) => el.classList.add('hidden'));
    document.getElementById(`view-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (tab === 'sheets') renderSheetsList();
    if (tab === 'create') renderRosterDropdown();
    if (tab === 'mark') renderMarkView();
    if (tab === 'transfer') renderTransferView();
  }

  function updateNetworkIndicator() {
    const pill = document.getElementById('network-pill');
    if (navigator.onLine) {
      pill.textContent = 'Online';
      pill.className = 'badge badge-present';
    } else {
      pill.textContent = 'Offline (Local)';
      pill.className = 'badge badge-warning';
    }
  }

  async function loadAllLocalData() {
    state.sheets = await idbGetAll('sheets', FALLBACK_SHEETS_KEY);
    state.sheets.sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''));
    state.rosters = await idbGetAll('rosters', FALLBACK_ROSTERS_KEY);
    if (!state.activeSheetId && state.sheets.length > 0) {
      state.activeSheetId = state.sheets[0].clientSheetId;
    }
  }

  function statusBadgeHtml(transferStatus) {
    if (transferStatus === 'transferred') {
      return '<span class="badge badge-present">Transferred</span>';
    }
    if (transferStatus === 'modified') {
      return '<span class="badge badge-warning">Edited • Re-sync</span>';
    }
    return '<span class="badge badge-info">Saved on Phone</span>';
  }

  // TAB 1: Sheets
  function renderSheetsList() {
    const container = document.getElementById('sheets-list');
    const dateFilter = document.getElementById('filter-sheet-date').value;
    const subjFilter = document.getElementById('filter-sheet-subject').value.trim().toLowerCase();

    const filtered = state.sheets.filter((s) => {
      if (dateFilter && s.date !== dateFilter) return false;
      if (subjFilter && !(s.subject || '').toLowerCase().includes(subjFilter)) return false;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="card empty-state">
          <h3>No Attendance Sheets Stored Yet</h3>
          <p>Tap <strong>Create List</strong> below to add students and start taking attendance on your phone.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered
      .map((sheet) => {
        const counts = computeSheetCounts(sheet);
        return `
          <div class="card">
            <div class="card-header" style="margin-bottom: 8px;">
              <div>
                <div style="font-weight: 800; font-size: 1rem;">${U.escapeHtml(sheet.subject)}</div>
                <div class="muted" style="font-size: 0.83rem;">
                  ${U.escapeHtml(U.formatDateHuman(sheet.date))} • ${U.escapeHtml(sheet.time || '')}
                  ${sheet.className ? ` • ${U.escapeHtml(sheet.className)}` : ''}
                </div>
              </div>
              ${statusBadgeHtml(sheet.transferStatus)}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
              <span class="badge badge-present">Present: ${counts.present}</span>
              <span class="badge badge-absent">Absent: ${counts.absent}</span>
              ${counts.unmarked > 0 ? `<span class="badge badge-warning">Unmarked: ${counts.unmarked}</span>` : ''}
              <span class="badge badge-neutral">Total: ${counts.total} (${counts.percentage}%)</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              <button class="btn btn-primary btn-sm" data-action="open-mark" data-id="${U.escapeHtml(sheet.clientSheetId)}">Open / Mark</button>
              <button class="btn btn-sm" data-action="quick-transfer" data-id="${U.escapeHtml(sheet.clientSheetId)}">Send to PC</button>
              <button class="btn btn-sm" data-action="export-bt" data-id="${U.escapeHtml(sheet.clientSheetId)}">Bluetooth Export</button>
              <button class="btn btn-sm" data-action="delete-sheet" data-id="${U.escapeHtml(sheet.clientSheetId)}" style="color: var(--absent);">Delete</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // TAB 2: Create List
  function renderRosterDropdown() {
    const select = document.getElementById('saved-roster-select');
    const current = select.value;
    select.innerHTML = '<option value="">-- Select a saved roster --</option>';
    for (const r of state.rosters) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.name} (${r.students.length} students)`;
      select.appendChild(opt);
    }
    if (current) select.value = current;
  }

  function renderDraftStudents() {
    const container = document.getElementById('draft-students-list');
    state.draftStudents.sort((a, b) => U.naturalCompare(a.rollNumber, b.rollNumber));

    if (state.draftStudents.length === 0) {
      container.innerHTML = '<p class="muted">No students added yet. Add Roll No + Name above or load the sample class.</p>';
      return;
    }

    container.innerHTML = `
      <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; color: var(--text-muted);">
        Student List (${state.draftStudents.length})
      </div>
      <div class="student-pill-list">
        ${state.draftStudents
          .map(
            (st, idx) => `
          <div class="student-mini-row">
            <div><strong>${U.escapeHtml(st.rollNumber)}</strong> — ${U.escapeHtml(st.studentName)}</div>
            <button type="button" class="btn btn-sm" data-remove-draft="${idx}" style="min-height: 28px; color: var(--absent);">Remove</button>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function addDraftStudent(rollNumber, studentName) {
    const roll = String(rollNumber || '').trim();
    const name = String(studentName || '').trim();
    if (!roll || !name) return false;
    const exists = state.draftStudents.some((s) => s.rollNumber.toLowerCase() === roll.toLowerCase());
    if (exists) {
      U.showToast(`Roll No ${roll} is already in the list`, 'warning');
      return false;
    }
    state.draftStudents.push({ rollNumber: roll, studentName: name });
    return true;
  }

  // TAB 3: Mark Attendance
  function getActiveSheet() {
    return state.sheets.find((s) => s.clientSheetId === state.activeSheetId) || null;
  }

  async function saveSheetLocal(sheet) {
    sheet.updatedAt = new Date().toISOString();
    await idbPut('sheets', sheet, 'clientSheetId', FALLBACK_SHEETS_KEY);
    const idx = state.sheets.findIndex((s) => s.clientSheetId === sheet.clientSheetId);
    if (idx >= 0) state.sheets[idx] = sheet;
    else state.sheets.unshift(sheet);
  }

  function renderMarkView() {
    const sheet = getActiveSheet();
    const emptyEl = document.getElementById('mark-empty');
    const workEl = document.getElementById('mark-workspace');

    if (!sheet) {
      emptyEl.classList.remove('hidden');
      workEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    workEl.classList.remove('hidden');

    sheet.records.sort((a, b) => U.naturalCompare(a.rollNumber, b.rollNumber));
    const counts = computeSheetCounts(sheet);

    document.getElementById('mark-sheet-title').textContent = sheet.subject;
    document.getElementById('mark-sheet-meta').textContent =
      `${U.formatDateHuman(sheet.date)} • ${sheet.className || 'Class'} • ${sheet.facultyName || 'Faculty'}`;
    document.getElementById('mark-present-count').textContent = counts.present;
    document.getElementById('mark-absent-count').textContent = counts.absent;
    document.getElementById('mark-unmarked-count').textContent = counts.unmarked;

    const pctMarked = counts.total > 0 ? Math.round((counts.marked / counts.total) * 100) : 0;
    document.getElementById('mark-progress-bar').style.width = `${pctMarked}%`;

    // Roll call card
    const rollCallEl = document.getElementById('roll-call-container');
    if (state.rollCallMode && sheet.records.length > 0) {
      rollCallEl.classList.remove('hidden');
      if (state.rollCallIndex >= sheet.records.length) state.rollCallIndex = 0;
      const rec = sheet.records[state.rollCallIndex];
      const currentStatusText = rec.status ? `Current: ${rec.status}` : 'Unmarked';
      rollCallEl.innerHTML = `
        <div class="muted" style="font-size: 0.82rem; font-weight: 700;">
          ROLL CALL ${state.rollCallIndex + 1} OF ${sheet.records.length} • ${U.escapeHtml(currentStatusText)}
        </div>
        <div class="roll-call-number">Roll ${U.escapeHtml(rec.rollNumber)}</div>
        <div class="roll-call-name">${U.escapeHtml(rec.studentName)}</div>
        <div class="roll-call-buttons">
          <button type="button" class="btn btn-success btn-lg" data-rollcall-mark="Present">Present</button>
          <button type="button" class="btn btn-danger btn-lg" data-rollcall-mark="Absent">Absent</button>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 12px;">
          <button type="button" class="btn btn-sm" data-rollcall-nav="-1">&larr; Prev</button>
          <button type="button" class="btn btn-sm" data-rollcall-nav="1">Next &rarr;</button>
        </div>
      `;
    } else {
      rollCallEl.classList.add('hidden');
    }

    // Standard list
    const listEl = document.getElementById('mark-students-container');
    listEl.innerHTML = sheet.records
      .map((rec) => {
        const rowCls = rec.status === 'Present' ? 'is-present' : rec.status === 'Absent' ? 'is-absent' : '';
        return `
          <div class="mark-row ${rowCls}">
            <div>
              <div style="font-weight: 700;">Roll ${U.escapeHtml(rec.rollNumber)} — ${U.escapeHtml(rec.studentName)}</div>
              <div class="muted" style="font-size: 0.78rem;">
                ${rec.status ? `${U.escapeHtml(rec.status)} at ${U.escapeHtml(rec.markedTime || sheet.time)}` : 'Tap Present or Absent'}
              </div>
            </div>
            <div class="mark-actions">
              <button type="button" class="mark-toggle ${rec.status === 'Present' ? 'active-present' : ''}" data-mark-roll="${U.escapeHtml(rec.rollNumber)}" data-mark-val="Present">Present</button>
              <button type="button" class="mark-toggle ${rec.status === 'Absent' ? 'active-absent' : ''}" data-mark-roll="${U.escapeHtml(rec.rollNumber)}" data-mark-val="Absent">Absent</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  async function markStudentStatus(rollNumber, status, advanceRollCall = false) {
    const sheet = getActiveSheet();
    if (!sheet) return;
    const rec = sheet.records.find((r) => r.rollNumber === rollNumber);
    if (!rec) return;
    rec.status = status;
    rec.markedTime = U.getLocalTimeString();
    if (sheet.transferStatus === 'transferred') {
      sheet.transferStatus = 'modified';
    }
    await saveSheetLocal(sheet);
    if (advanceRollCall && state.rollCallIndex < sheet.records.length - 1) {
      state.rollCallIndex += 1;
    }
    renderMarkView();
  }

  // TAB 4: Transfer
  function buildTransferPayload(sheet, transferMethod) {
    const unmarkedCount = sheet.records.filter((r) => !r.status).length;
    if (unmarkedCount > 0) {
      throw new Error(`${unmarkedCount} student(s) are still unmarked. Please mark all students Present or Absent first.`);
    }
    return {
      clientSheetId: sheet.clientSheetId,
      title: `${sheet.subject} (${sheet.date})`,
      subject: sheet.subject,
      className: sheet.className || '',
      facultyName: sheet.facultyName || 'Faculty',
      date: sheet.date,
      time: sheet.time || U.getLocalTimeString(),
      transferMethod,
      sourceDevice: navigator.userAgent.includes('Android') ? 'Android Mobile Phone' : 'Mobile Faculty App (PWA)',
      records: sheet.records.map((r) => ({
        rollNumber: r.rollNumber,
        studentName: r.studentName,
        status: r.status,
        markedTime: r.markedTime || sheet.time || U.getLocalTimeString(),
      })),
    };
  }

  async function transferViaInternet(clientSheetId) {
    const sheet = state.sheets.find((s) => s.clientSheetId === clientSheetId);
    if (!sheet) return false;

    let payload;
    try {
      payload = buildTransferPayload(sheet, 'internet');
    } catch (err) {
      U.showToast(err.message, 'warning');
      return false;
    }

    const baseUrl = getServerUrl();
    try {
      const resp = await fetch(`${baseUrl}/api/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.details ? data.details.join(', ') : data.error || 'Transfer failed');
      }
      sheet.transferStatus = 'transferred';
      sheet.transferMethod = 'internet';
      sheet.transferredAt = new Date().toISOString();
      await saveSheetLocal(sheet);
      U.showToast(`Transferred "${sheet.subject}" to PC Server`, 'success');
      return true;
    } catch (err) {
      U.showToast(`Internet transfer failed: ${err.message}`, 'error');
      return false;
    }
  }

  async function exportForBluetooth(clientSheetId, format = 'json') {
    const sheet = state.sheets.find((s) => s.clientSheetId === clientSheetId);
    if (!sheet) return;
    let payload;
    try {
      payload = buildTransferPayload(sheet, 'bluetooth');
    } catch (err) {
      U.showToast(err.message, 'warning');
      return;
    }

    const safeSlug = `${sheet.subject}-${sheet.date}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const isCsv = format === 'csv';
    const filename = `attendance-${safeSlug}.${isCsv ? 'csv' : 'json'}`;
    const content = isCsv ? U.buildSheetCsv(payload) : JSON.stringify(payload, null, 2);
    const mimeType = isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';

    // Prefer Android native share sheet (which includes Bluetooth) when supported
    try {
      const file = new File([content], filename, { type: mimeType });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Attendance: ${sheet.subject} (${sheet.date})`,
          text: 'Send attendance sheet via Bluetooth to PC Server',
          files: [file],
        });
        U.showToast('Opened share sheet — select Bluetooth to send to PC', 'success');
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }

    U.downloadFile(filename, content, mimeType);
    U.showToast(`Downloaded ${filename}. Send via Bluetooth & import on PC Console.`, 'info');
  }

  async function testServerConnection() {
    const badge = document.getElementById('server-conn-badge');
    const urlInput = document.getElementById('server-url-input');
    setServerUrl(urlInput.value);
    const baseUrl = getServerUrl();

    badge.textContent = 'Testing...';
    badge.className = 'badge badge-info';
    try {
      const resp = await fetch(`${baseUrl}/api/health`);
      const data = await resp.json();
      if (resp.ok && data.status === 'ok') {
        badge.textContent = `Connected (${data.totalSheets} sheets on PC)`;
        badge.className = 'badge badge-present';
        U.showToast('PC Server connection OK', 'success');
      } else {
        throw new Error('Unexpected response');
      }
    } catch (err) {
      badge.textContent = 'Unreachable';
      badge.className = 'badge badge-absent';
      U.showToast(`Cannot reach ${baseUrl}`, 'error');
    }
  }

  function renderTransferView() {
    document.getElementById('server-url-input').value = getServerUrl();
    const container = document.getElementById('transfer-sheets-list');
    if (state.sheets.length === 0) {
      container.innerHTML = '<p class="muted">No sheets on phone memory yet.</p>';
      return;
    }

    container.innerHTML = state.sheets
      .map((sheet) => {
        const counts = computeSheetCounts(sheet);
        return `
          <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; gap: 8px; align-items: start; margin-bottom: 8px;">
              <div>
                <strong>${U.escapeHtml(sheet.subject)}</strong>
                <div class="muted" style="font-size: 0.82rem;">
                  ${U.escapeHtml(U.formatDateHuman(sheet.date))} • ${counts.present}P / ${counts.absent}A (${counts.total})
                </div>
              </div>
              ${statusBadgeHtml(sheet.transferStatus)}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              <button type="button" class="btn btn-primary btn-sm" data-transfer-internet="${U.escapeHtml(sheet.clientSheetId)}">Transfer via Internet</button>
              <button type="button" class="btn btn-sm" data-export-json="${U.escapeHtml(sheet.clientSheetId)}">Bluetooth JSON</button>
              <button type="button" class="btn btn-sm" data-export-csv="${U.escapeHtml(sheet.clientSheetId)}">Bluetooth CSV</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Event Binding
  function bindEvents() {
    document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('btn-new-sheet-shortcut').addEventListener('click', () => switchTab('create'));
    document.getElementById('btn-mark-go-create').addEventListener('click', () => switchTab('create'));
    document.getElementById('btn-finish-go-transfer').addEventListener('click', () => switchTab('transfer'));

    document.getElementById('filter-sheet-date').addEventListener('input', renderSheetsList);
    document.getElementById('filter-sheet-subject').addEventListener('input', renderSheetsList);

    document.getElementById('sheets-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'open-mark') {
        state.activeSheetId = id;
        state.rollCallIndex = 0;
        switchTab('mark');
      } else if (action === 'quick-transfer') {
        await transferViaInternet(id);
        renderSheetsList();
      } else if (action === 'export-bt') {
        await exportForBluetooth(id, 'json');
      } else if (action === 'delete-sheet') {
        await idbDelete('sheets', id, 'clientSheetId', FALLBACK_SHEETS_KEY);
        state.sheets = state.sheets.filter((s) => s.clientSheetId !== id);
        if (state.activeSheetId === id) {
          state.activeSheetId = state.sheets[0] ? state.sheets[0].clientSheetId : null;
        }
        renderSheetsList();
        U.showToast('Deleted local attendance sheet', 'info');
      }
    });

    // Create List events
    document.getElementById('btn-load-sample-students').addEventListener('click', () => {
      let added = 0;
      for (const st of SAMPLE_CLASS_STUDENTS) {
        if (addDraftStudent(st.rollNumber, st.studentName)) added += 1;
      }
      renderDraftStudents();
      U.showToast(`Loaded ${added} sample students`, 'success');
    });

    document.getElementById('btn-add-student').addEventListener('click', () => {
      const rollEl = document.getElementById('add-roll');
      const nameEl = document.getElementById('add-name');
      if (addDraftStudent(rollEl.value, nameEl.value)) {
        rollEl.value = '';
        nameEl.value = '';
        rollEl.focus();
        renderDraftStudents();
      }
    });

    document.getElementById('btn-import-bulk').addEventListener('click', () => {
      const raw = document.getElementById('bulk-students-text').value;
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let added = 0;
      for (const line of lines) {
        const parts = line.split(/[,\t]+/);
        if (parts.length >= 2) {
          const roll = parts[0].trim();
          const name = parts.slice(1).join(' ').trim();
          if (addDraftStudent(roll, name)) added += 1;
        }
      }
      renderDraftStudents();
      U.showToast(`Added ${added} students from paste`, added > 0 ? 'success' : 'warning');
    });

    document.getElementById('draft-students-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-remove-draft]');
      if (!btn) return;
      const idx = Number(btn.dataset.removeDraft);
      state.draftStudents.splice(idx, 1);
      renderDraftStudents();
    });

    document.getElementById('btn-apply-roster').addEventListener('click', () => {
      const rosterId = document.getElementById('saved-roster-select').value;
      const roster = state.rosters.find((r) => r.id === rosterId);
      if (!roster) return;
      state.draftStudents = roster.students.map((s) => ({ ...s }));
      if (!document.getElementById('create-subject').value && roster.subject) {
        document.getElementById('create-subject').value = roster.subject;
      }
      if (!document.getElementById('create-class').value && roster.className) {
        document.getElementById('create-class').value = roster.className;
      }
      renderDraftStudents();
      U.showToast(`Applied roster "${roster.name}"`, 'success');
    });

    document.getElementById('btn-save-create-sheet').addEventListener('click', async () => {
      const subject = document.getElementById('create-subject').value.trim();
      const className = document.getElementById('create-class').value.trim();
      const facultyName = document.getElementById('create-faculty').value.trim() || 'Faculty';
      const date = document.getElementById('create-date').value;

      if (!subject) {
        U.showToast('Please enter a Subject name', 'warning');
        return;
      }
      if (!date) {
        U.showToast('Please select a Date', 'warning');
        return;
      }
      if (state.draftStudents.length === 0) {
        U.showToast('Please add at least one student', 'warning');
        return;
      }

      localStorage.setItem(FACULTY_NAME_KEY, facultyName);

      if (document.getElementById('save-roster-checkbox').checked) {
        const rosterName = `${subject}${className ? ` - ${className}` : ''}`;
        const roster = {
          id: rosterName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: rosterName,
          subject,
          className,
          students: state.draftStudents.map((s) => ({ ...s })),
        };
        await idbPut('rosters', roster, 'id', FALLBACK_ROSTERS_KEY);
        const existingIdx = state.rosters.findIndex((r) => r.id === roster.id);
        if (existingIdx >= 0) state.rosters[existingIdx] = roster;
        else state.rosters.push(roster);
      }

      const nowTime = U.getLocalTimeString();
      const newSheet = {
        clientSheetId: U.generateUuid(),
        subject,
        className,
        facultyName,
        date,
        time: nowTime,
        transferStatus: 'local',
        records: [...state.draftStudents]
          .sort((a, b) => U.naturalCompare(a.rollNumber, b.rollNumber))
          .map((s) => ({
            rollNumber: s.rollNumber,
            studentName: s.studentName,
            status: '',
            markedTime: '',
          })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveSheetLocal(newSheet);
      state.activeSheetId = newSheet.clientSheetId;
      state.rollCallIndex = 0;
      U.showToast('Attendance sheet saved to phone memory', 'success');
      switchTab('mark');
    });

    // Mark events
    document.getElementById('toggle-roll-call').addEventListener('change', (e) => {
      state.rollCallMode = e.target.checked;
      renderMarkView();
    });

    document.getElementById('btn-all-present').addEventListener('click', async () => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      const t = U.getLocalTimeString();
      sheet.records.forEach((r) => {
        r.status = 'Present';
        r.markedTime = t;
      });
      if (sheet.transferStatus === 'transferred') sheet.transferStatus = 'modified';
      await saveSheetLocal(sheet);
      renderMarkView();
      U.showToast('Marked all students Present', 'success');
    });

    document.getElementById('btn-all-absent').addEventListener('click', async () => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      const t = U.getLocalTimeString();
      sheet.records.forEach((r) => {
        r.status = 'Absent';
        r.markedTime = t;
      });
      if (sheet.transferStatus === 'transferred') sheet.transferStatus = 'modified';
      await saveSheetLocal(sheet);
      renderMarkView();
      U.showToast('Marked all students Absent', 'info');
    });

    document.getElementById('mark-students-container').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mark-roll]');
      if (!btn) return;
      markStudentStatus(btn.dataset.markRoll, btn.dataset.markVal, false);
    });

    document.getElementById('roll-call-container').addEventListener('click', (e) => {
      const markBtn = e.target.closest('button[data-rollcall-mark]');
      if (markBtn) {
        const sheet = getActiveSheet();
        if (!sheet) return;
        const rec = sheet.records[state.rollCallIndex];
        if (rec) markStudentStatus(rec.rollNumber, markBtn.dataset.rollcallMark, true);
        return;
      }
      const navBtn = e.target.closest('button[data-rollcall-nav]');
      if (navBtn) {
        const sheet = getActiveSheet();
        if (!sheet) return;
        const delta = Number(navBtn.dataset.rollcallNav);
        state.rollCallIndex = Math.max(0, Math.min(sheet.records.length - 1, state.rollCallIndex + delta));
        renderMarkView();
      }
    });

    // Transfer events
    document.getElementById('btn-test-server').addEventListener('click', testServerConnection);
    document.getElementById('server-url-input').addEventListener('change', (e) => setServerUrl(e.target.value));

    document.getElementById('btn-transfer-all').addEventListener('click', async () => {
      setServerUrl(document.getElementById('server-url-input').value);
      const pending = state.sheets.filter((s) => s.transferStatus !== 'transferred');
      if (pending.length === 0) {
        U.showToast('All stored sheets are already transferred', 'info');
        return;
      }
      let ok = 0;
      for (const sheet of pending) {
        if (await transferViaInternet(sheet.clientSheetId)) ok += 1;
      }
      renderTransferView();
      U.showToast(`Transferred ${ok} of ${pending.length} pending sheet(s)`, ok > 0 ? 'success' : 'warning');
    });

    document.getElementById('transfer-sheets-list').addEventListener('click', async (e) => {
      const internetBtn = e.target.closest('button[data-transfer-internet]');
      if (internetBtn) {
        setServerUrl(document.getElementById('server-url-input').value);
        await transferViaInternet(internetBtn.dataset.transferInternet);
        renderTransferView();
        return;
      }
      const jsonBtn = e.target.closest('button[data-export-json]');
      if (jsonBtn) {
        await exportForBluetooth(jsonBtn.dataset.exportJson, 'json');
        return;
      }
      const csvBtn = e.target.closest('button[data-export-csv]');
      if (csvBtn) {
        await exportForBluetooth(csvBtn.dataset.exportCsv, 'csv');
      }
    });

    window.addEventListener('online', updateNetworkIndicator);
    window.addEventListener('offline', updateNetworkIndicator);
  }

  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile/sw.js').catch(() => {});
    }

    updateNetworkIndicator();
    document.getElementById('create-date').value = U.getLocalDateString();
    document.getElementById('create-faculty').value = localStorage.getItem(FACULTY_NAME_KEY) || '';
    document.getElementById('server-url-input').value = getServerUrl();

    await loadAllLocalData();
    bindEvents();
    renderSheetsList();
    renderDraftStudents();
    renderRosterDropdown();
  }

  init();
})();
