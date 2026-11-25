(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getLocalDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getLocalTimeString(date = new Date()) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function formatDateHuman(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
    const [y, m, d] = isoDate.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d).padStart(2, '0')} ${months[m - 1] || m} ${y}`;
  }

  function naturalCompare(a, b) {
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  function generateUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'sheet-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function escapeCsvCell(val) {
    const str = val === undefined || val === null ? '' : String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function buildSheetCsv(sheet) {
    const headers = [
      'Roll Number',
      'Student Name',
      'Status',
      'Subject',
      'Class',
      'Faculty',
      'Date',
      'Time',
    ];
    const lines = [headers.join(',')];
    const records = [...(sheet.records || [])].sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber));
    for (const rec of records) {
      lines.push(
        [
          rec.rollNumber,
          rec.studentName,
          rec.status || 'Absent',
          sheet.subject || '',
          sheet.className || '',
          sheet.facultyName || '',
          sheet.date || '',
          rec.markedTime || sheet.time || '',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
    return lines.join('\r\n');
  }

  function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = 'info', durationMs = 3400) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  global.AttendanceUtils = {
    escapeHtml,
    getLocalDateString,
    getLocalTimeString,
    formatDateHuman,
    naturalCompare,
    generateUuid,
    buildSheetCsv,
    downloadFile,
    showToast,
  };
})(window);
