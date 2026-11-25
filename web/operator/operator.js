(function () {
  'use strict';

  const U = window.AttendanceUtils;

  const state = {
    activeTab: 'check',
    sortBy: 'date',
    sortDir: 'desc',
    selectedFile: null,
    attendanceData: null,
    sheets: [],
    analytics: null,
  };

  function getAttendanceQueryParams() {
    const params = new URLSearchParams();
    const date = document.getElementById('filter-date').value;
    const subject = document.getElementById('filter-subject').value;
    const search = document.getElementById('filter-search').value.trim();
    const status = document.getElementById('filter-status').value;
    const method = document.getElementById('filter-method').value;

    if (date) params.set('date', date);
    if (subject) params.set('subject', subject);
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (method) params.set('transferMethod', method);
    params.set('sortBy', state.sortBy);
    params.set('sortDir', state.sortDir);
    return params;
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.operator-tab').forEach((el) => el.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    if (tabName === 'check') loadAttendance();
    if (tabName === 'sheets') loadSheets();
    if (tabName === 'analytics') loadAnalytics();
  }

  function methodBadge(method) {
    if (method === 'bluetooth') return '<span class="badge badge-info">Bluetooth</span>';
    if (method === 'file_import') return '<span class="badge badge-neutral">File Import</span>';
    return '<span class="badge badge-present">Internet</span>';
  }

  function statusBadge(status) {
    return status === 'Present'
      ? '<span class="badge badge-present">Present</span>'
      : '<span class="badge badge-absent">Absent</span>';
  }

  // TAB 1: Attendance Check
  async function loadAttendance() {
    const params = getAttendanceQueryParams();
    try {
      const resp = await fetch(`/api/attendance?${params.toString()}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load attendance');
      state.attendanceData = data;
      renderAttendanceCheck(data);
    } catch (err) {
      U.showToast(err.message, 'error');
    }
  }

  function populateDropdowns(availableFilters) {
    const subjSelect = document.getElementById('filter-subject');
    const currentSubj = subjSelect.value;
    subjSelect.innerHTML = '<option value="">All Subjects</option>';
    for (const subj of availableFilters.subjects || []) {
      const opt = document.createElement('option');
      opt.value = subj;
      opt.textContent = subj;
      subjSelect.appendChild(opt);
    }
    if (currentSubj) subjSelect.value = currentSubj;

    const analyticsSubj = document.getElementById('analytics-subject-filter');
    const currAnalyticSubj = analyticsSubj.value;
    analyticsSubj.innerHTML = '<option value="">All Subjects</option>';
    for (const subj of availableFilters.subjects || []) {
      const opt = document.createElement('option');
      opt.value = subj;
      opt.textContent = subj;
      analyticsSubj.appendChild(opt);
    }
    if (currAnalyticSubj) analyticsSubj.value = currAnalyticSubj;

    // Date quick chips
    const chipsEl = document.getElementById('date-chips');
    const activeDate = document.getElementById('filter-date').value;
    const dates = (availableFilters.dates || []).slice(0, 8);
    if (dates.length === 0) {
      chipsEl.innerHTML = '';
      return;
    }

    chipsEl.innerHTML = `
      <button type="button" class="date-chip ${activeDate === '' ? 'active' : ''}" data-chip-date="">All Dates</button>
      ${dates
        .map(
          (d) => `<button type="button" class="date-chip ${activeDate === d ? 'active' : ''}" data-chip-date="${U.escapeHtml(d)}">${U.escapeHtml(U.formatDateHuman(d))}</button>`
        )
        .join('')}
    `;
  }

  function renderSplitPresenteesAbsentees(data) {
    const splitSection = document.getElementById('split-section');
    const selectedDate = document.getElementById('filter-date').value;
    const dates = (data.availableFilters && data.availableFilters.dates) || [];
    const targetDate = selectedDate || dates[0] || '';

    if (!targetDate || data.records.length === 0) {
      splitSection.classList.add('hidden');
      return;
    }

    splitSection.classList.remove('hidden');
    const scopeRecords = selectedDate
      ? data.records
      : data.records.filter((r) => r.date === targetDate);

    const presentees = scopeRecords.filter((r) => r.status === 'Present');
    const absentees = scopeRecords.filter((r) => r.status === 'Absent');
    const dateLabel = U.formatDateHuman(targetDate);

    document.getElementById('presentees-title').textContent = `Presentees (${dateLabel})`;
    document.getElementById('absentees-title').textContent = `Absentees (${dateLabel})`;
    document.getElementById('presentees-count').textContent = presentees.length;
    document.getElementById('absentees-count').textContent = absentees.length;

    const renderMiniList = (list, emptyMsg) => {
      if (list.length === 0) {
        return `<p class="muted" style="margin: 4px 0;">${emptyMsg}</p>`;
      }
      return `<div class="student-pill-list">${list
        .map(
          (r) => `
          <div class="student-mini-row">
            <div><strong>${U.escapeHtml(r.rollNumber)}</strong> — ${U.escapeHtml(r.studentName)}</div>
            <div class="muted" style="font-size: 0.78rem;">${U.escapeHtml(r.subject)} • ${U.escapeHtml(r.time)}</div>
          </div>
        `
        )
        .join('')}</div>`;
    };

    document.getElementById('presentees-list').innerHTML = renderMiniList(presentees, 'No presentees for this filter.');
    document.getElementById('absentees-list').innerHTML = renderMiniList(absentees, 'No absentees for this filter.');
  }

  function renderAttendanceCheck(data) {
    populateDropdowns(data.availableFilters || {});

    document.getElementById('kpi-total').textContent = data.summary.total;
    document.getElementById('kpi-present').textContent = data.summary.present;
    document.getElementById('kpi-absent').textContent = data.summary.absent;
    document.getElementById('kpi-pct').textContent = `${data.summary.percentage}%`;
    document.getElementById('records-count-label').textContent = `${data.records.length} record(s)`;

    renderSplitPresenteesAbsentees(data);

    const container = document.getElementById('attendance-table-container');
    if (data.records.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No Attendance Records Found</h3>
          <p>Transfer a sheet from the <a href="/mobile">Mobile Faculty App</a>, import a Bluetooth file, or click <strong>Load Sample Data</strong> in the header.</p>
        </div>
      `;
      return;
    }

    const arrow = (col) => (state.sortBy === col ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" data-sort="roll_number">Roll No${arrow('roll_number')}</th>
              <th class="sortable" data-sort="student_name">Student Name${arrow('student_name')}</th>
              <th class="sortable" data-sort="subject">Subject${arrow('subject')}</th>
              <th class="sortable" data-sort="date">Date${arrow('date')}</th>
              <th class="sortable" data-sort="time">Time${arrow('time')}</th>
              <th class="sortable" data-sort="status">Status${arrow('status')}</th>
              <th>Faculty</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            ${data.records
              .map(
                (r) => `
              <tr>
                <td><strong>${U.escapeHtml(r.rollNumber)}</strong></td>
                <td>${U.escapeHtml(r.studentName)}</td>
                <td>${U.escapeHtml(r.subject)}</td>
                <td>${U.escapeHtml(r.date)}</td>
                <td>${U.escapeHtml(r.time)}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${U.escapeHtml(r.facultyName)}</td>
                <td>${methodBadge(r.transferMethod)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // TAB 2: Transferred Sheets
  async function loadSheets() {
    try {
      const resp = await fetch('/api/sheets?sortBy=date&sortDir=desc');
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load sheets');
      state.sheets = data.sheets || [];
      renderSheetsTable();
    } catch (err) {
      U.showToast(err.message, 'error');
    }
  }

  function renderSheetsTable() {
    const container = document.getElementById('sheets-table-container');
    if (state.sheets.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No Transferred Sheets Yet</h3>
          <p>Sheets sent via Internet or Bluetooth from the faculty phone will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Subject</th>
              <th>Class</th>
              <th>Faculty</th>
              <th>Present / Absent</th>
              <th>Attendance %</th>
              <th>Method</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.sheets
              .map(
                (s) => `
              <tr>
                <td><strong>${U.escapeHtml(s.date)}</strong></td>
                <td>${U.escapeHtml(s.time)}</td>
                <td>${U.escapeHtml(s.subject)}</td>
                <td>${U.escapeHtml(s.className || '—')}</td>
                <td>${U.escapeHtml(s.facultyName)}</td>
                <td>
                  <span class="badge badge-present">${s.presentCount} P</span>
                  <span class="badge badge-absent">${s.absentCount} A</span>
                  <span class="muted">(${s.totalCount})</span>
                </td>
                <td><strong>${s.attendancePercentage}%</strong></td>
                <td>${methodBadge(s.transferMethod)}</td>
                <td style="white-space: nowrap;">
                  <button type="button" class="btn btn-sm" data-view-sheet="${s.id}">View</button>
                  <button type="button" class="btn btn-sm" data-csv-sheet="${s.id}">CSV</button>
                  <button type="button" class="btn btn-sm" data-delete-sheet="${s.id}" style="color: var(--absent);">Delete</button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function openSheetModal(sheetId) {
    try {
      const resp = await fetch(`/api/sheets/${sheetId}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Sheet not found');

      const s = data.sheet;
      document.getElementById('modal-sheet-title').textContent = `${s.subject} — ${U.formatDateHuman(s.date)}`;
      document.getElementById('modal-sheet-subtitle').textContent =
        `Class: ${s.className || '—'} • Faculty: ${s.facultyName} • Time: ${s.time} • Source: ${s.sourceDevice}`;

      document.getElementById('modal-sheet-body').innerHTML = `
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          <span class="badge badge-present">Present: ${data.stats.present}</span>
          <span class="badge badge-absent">Absent: ${data.stats.absent}</span>
          <span class="badge badge-neutral">Total: ${data.stats.total} (${data.stats.percentage}%)</span>
          ${methodBadge(s.transferMethod)}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll No</th>
                <th>Student Name</th>
                <th>Status</th>
                <th>Marked Time</th>
              </tr>
            </thead>
            <tbody>
              ${data.records
                .map(
                  (r) => `
                <tr>
                  <td><strong>${U.escapeHtml(r.rollNumber)}</strong></td>
                  <td>${U.escapeHtml(r.studentName)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${U.escapeHtml(r.markedTime)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('sheet-modal-backdrop').classList.remove('hidden');
    } catch (err) {
      U.showToast(err.message, 'error');
    }
  }

  async function downloadSingleSheetCsv(sheetId) {
    try {
      const resp = await fetch(`/api/sheets/${sheetId}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to export sheet');
      const s = data.sheet;
      const csv = U.buildSheetCsv({ ...s, records: data.records });
      const slug = `${s.subject}-${s.date}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      U.downloadFile(`sheet-${slug}.csv`, csv, 'text/csv;charset=utf-8');
    } catch (err) {
      U.showToast(err.message, 'error');
    }
  }

  // TAB 3: Analytics
  async function loadAnalytics() {
    const subj = document.getElementById('analytics-subject-filter').value;
    const params = new URLSearchParams();
    if (subj) params.set('subject', subj);

    try {
      const resp = await fetch(`/api/analytics?${params.toString()}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load analytics');
      state.analytics = data;
      renderAnalytics(data);
    } catch (err) {
      U.showToast(err.message, 'error');
    }
  }

  function renderDateSvgChart(byDate) {
    if (!byDate || byDate.length === 0) {
      return '<p class="muted">No date trend data available yet.</p>';
    }
    const barW = 48;
    const gap = 16;
    const padLeft = 34;
    const chartH = 160;
    const svgW = Math.max(340, padLeft + byDate.length * (barW + gap) + 20);
    const svgH = chartH + 46;

    const bars = byDate
      .map((d, i) => {
        const x = padLeft + i * (barW + gap);
        const h = Math.round((d.percentage / 100) * (chartH - 20));
        const y = chartH - h;
        const fill = d.percentage >= 75 ? '#15803d' : d.percentage >= 60 ? '#b45309' : '#b91c1c';
        const shortDate = d.date.slice(5);
        return `
          <g>
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${fill}" opacity="0.9"></rect>
            <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">${d.percentage}%</text>
            <text x="${x + barW / 2}" y="${chartH + 18}" text-anchor="middle" font-size="11" fill="#475569">${U.escapeHtml(shortDate)}</text>
            <text x="${x + barW / 2}" y="${chartH + 33}" text-anchor="middle" font-size="10" fill="#64748b">${d.present}/${d.total}</text>
          </g>
        `;
      })
      .join('');

    return `
      <div class="table-wrap">
        <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}" role="img" aria-label="Date-wise Attendance Percentage Chart">
          <line x1="${padLeft - 6}" y1="${chartH}" x2="${svgW - 10}" y2="${chartH}" stroke="#cbd5e1" stroke-width="1.5" />
          ${bars}
        </svg>
      </div>
    `;
  }

  function renderAnalytics(data) {
    const o = data.overall;
    document.getElementById('analytics-kpi-grid').innerHTML = `
      <div class="kpi-card accent">
        <div class="kpi-label">Overall Class Attendance</div>
        <div class="kpi-value">${o.overallPercentage}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Sessions</div>
        <div class="kpi-value">${o.totalSheets}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Unique Students</div>
        <div class="kpi-value">${o.uniqueStudents}</div>
      </div>
      <div class="kpi-card present">
        <div class="kpi-label">Total Present Marks</div>
        <div class="kpi-value">${o.totalPresent}</div>
      </div>
      <div class="kpi-card absent">
        <div class="kpi-label">Total Absent Marks</div>
        <div class="kpi-value">${o.totalAbsent}</div>
      </div>
    `;

    document.getElementById('analytics-date-chart').innerHTML = renderDateSvgChart(data.byDate);

    const subjEl = document.getElementById('analytics-subject-bars');
    if (data.bySubject.length === 0) {
      subjEl.innerHTML = '<p class="muted">No subject breakdown available.</p>';
    } else {
      subjEl.innerHTML = data.bySubject
        .map((s) => {
          const barCls = s.percentage < 60 ? 'danger' : s.percentage < 75 ? 'warn' : '';
          return `
            <div style="margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px;">
                <strong>${U.escapeHtml(s.subject)}</strong>
                <span><strong>${s.percentage}%</strong> (${s.present}/${s.total} across ${s.sessions} session${s.sessions === 1 ? '' : 's'})</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill ${barCls}" style="width: ${s.percentage}%;"></div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    const stEl = document.getElementById('analytics-student-table');
    if (data.byStudent.length === 0) {
      stEl.innerHTML = '<p class="muted">No student attendance records yet.</p>';
    } else {
      stEl.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll No</th>
                <th>Student Name</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Total Classes</th>
                <th>Attendance %</th>
                <th>Standing</th>
              </tr>
            </thead>
            <tbody>
              ${data.byStudent
                .map(
                  (st) => `
                <tr>
                  <td><strong>${U.escapeHtml(st.rollNumber)}</strong></td>
                  <td>${U.escapeHtml(st.studentName)}</td>
                  <td>${st.presentCount}</td>
                  <td>${st.absentCount}</td>
                  <td>${st.totalClasses}</td>
                  <td><strong>${st.percentage}%</strong></td>
                  <td>
                    ${st.lowAttendance
                      ? '<span class="badge badge-absent">Low (&lt; 75%)</span>'
                      : '<span class="badge badge-present">Good</span>'}
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // TAB 4: Import Bluetooth / File
  function handleFileSelected(file) {
    if (!file) return;
    state.selectedFile = file;
    document.getElementById('selected-file-label').textContent = `Selected: ${file.name} (${file.size} bytes)`;
    document.getElementById('btn-upload-submit').disabled = false;
    document.getElementById('import-result-box').innerHTML = '';
  }

  async function submitFileUpload() {
    if (!state.selectedFile) return;
    const btn = document.getElementById('btn-upload-submit');
    btn.disabled = true;

    try {
      const content = await state.selectedFile.text();
      const payload = {
        filename: state.selectedFile.name,
        content,
        transferMethod: document.getElementById('import-method').value || 'bluetooth',
        subject: document.getElementById('import-subject').value.trim() || undefined,
        date: document.getElementById('import-date').value || undefined,
        facultyName: document.getElementById('import-faculty').value.trim() || undefined,
      };

      const resp = await fetch('/api/transfers/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.details ? data.details.join('; ') : data.error || 'Import failed');
      }

      document.getElementById('import-result-box').innerHTML = `
        <div class="badge badge-present" style="padding: 8px 12px; font-size: 0.9rem;">
          Imported ${data.importedCount} sheet(s) into PC Server storage!
        </div>
      `;
      U.showToast(`Imported ${data.importedCount} attendance sheet(s)`, 'success');
      state.selectedFile = null;
      document.getElementById('import-file-input').value = '';
      document.getElementById('selected-file-label').textContent = '';
      await Promise.all([loadAttendance(), loadSheets(), loadAnalytics()]);
    } catch (err) {
      document.getElementById('import-result-box').innerHTML = `
        <div class="badge badge-absent" style="padding: 8px 12px; font-size: 0.9rem;">
          Error: ${U.escapeHtml(err.message)}
        </div>
      `;
      U.showToast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // Event Binding
  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('btn-header-import').addEventListener('click', () => switchTab('import'));

    document.getElementById('btn-refresh-all').addEventListener('click', async () => {
      await Promise.all([loadAttendance(), loadSheets(), loadAnalytics()]);
      U.showToast('Refreshed server data', 'info');
    });

    document.getElementById('btn-seed-demo').addEventListener('click', async () => {
      try {
        const resp = await fetch('/api/demo/seed', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to load sample data');
        U.showToast(`Loaded ${data.totalSampleSheets} sample attendance sheets`, 'success');
        await Promise.all([loadAttendance(), loadSheets(), loadAnalytics()]);
      } catch (err) {
        U.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const params = getAttendanceQueryParams();
      window.location.href = `/api/attendance/export?${params.toString()}`;
    });

    // Filters
    ['filter-date', 'filter-subject', 'filter-status', 'filter-method'].forEach((id) => {
      document.getElementById(id).addEventListener('change', loadAttendance);
    });
    document.getElementById('filter-search').addEventListener('input', loadAttendance);

    document.getElementById('sort-by').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      loadAttendance();
    });

    document.getElementById('btn-sort-dir').addEventListener('click', (e) => {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      e.target.textContent = state.sortDir === 'desc' ? 'Desc' : 'Asc';
      loadAttendance();
    });

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      document.getElementById('filter-date').value = '';
      document.getElementById('filter-subject').value = '';
      document.getElementById('filter-search').value = '';
      document.getElementById('filter-status').value = '';
      document.getElementById('filter-method').value = '';
      state.sortBy = 'date';
      state.sortDir = 'desc';
      document.getElementById('sort-by').value = 'date';
      document.getElementById('btn-sort-dir').textContent = 'Desc';
      loadAttendance();
    });

    document.getElementById('date-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-chip-date]');
      if (!btn) return;
      document.getElementById('filter-date').value = btn.dataset.chipDate;
      loadAttendance();
    });

    document.getElementById('attendance-table-container').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const col = th.dataset.sort;
      if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = col;
        state.sortDir = col === 'date' ? 'desc' : 'asc';
      }
      document.getElementById('sort-by').value = state.sortBy;
      document.getElementById('btn-sort-dir').textContent = state.sortDir === 'desc' ? 'Desc' : 'Asc';
      loadAttendance();
    });

    // Sheets table actions
    document.getElementById('sheets-table-container').addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('button[data-view-sheet]');
      if (viewBtn) {
        openSheetModal(viewBtn.dataset.viewSheet);
        return;
      }
      const csvBtn = e.target.closest('button[data-csv-sheet]');
      if (csvBtn) {
        downloadSingleSheetCsv(csvBtn.dataset.csvSheet);
        return;
      }
      const delBtn = e.target.closest('button[data-delete-sheet]');
      if (delBtn) {
        const id = delBtn.dataset.deleteSheet;
        try {
          const resp = await fetch(`/api/sheets/${id}`, { method: 'DELETE' });
          if (!resp.ok) throw new Error('Delete failed');
          U.showToast('Sheet deleted from PC Server', 'info');
          await Promise.all([loadSheets(), loadAttendance(), loadAnalytics()]);
        } catch (err) {
          U.showToast(err.message, 'error');
        }
      }
    });

    // Analytics filter
    document.getElementById('analytics-subject-filter').addEventListener('change', loadAnalytics);

    // Import dropzone
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');
    document.getElementById('btn-choose-file').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });
    document.getElementById('btn-upload-submit').addEventListener('click', submitFileUpload);

    // Modal
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      document.getElementById('sheet-modal-backdrop').classList.add('hidden');
    });
    document.getElementById('sheet-modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'sheet-modal-backdrop') {
        document.getElementById('sheet-modal-backdrop').classList.add('hidden');
      }
    });
  }

  function init() {
    bindEvents();
    loadAttendance();
  }

  init();
})();
