/**
 * Lightweight client-side exporters — no extra dependencies.
 *  - CSV:   RFC-4180 quoted, UTF-8 BOM so Excel reads accents correctly
 *  - Excel: an HTML-table .xls blob (Excel opens it with real columns)
 *  - PDF:   browser print dialog (Save as PDF), scoped by @media print CSS
 */

function toCell(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** columns: [{ key, label, render? }] */
export function downloadCSV(baseName, rows, columns) {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => esc(toCell(c.render ? c.render(row[c.key], row) : row[c.key]))).join(','))
    .join('\r\n');
  const blob = new Blob(['﻿' + header + '\r\n' + body], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${baseName}-${timestamp()}.csv`);
}

export function downloadExcel(baseName, rows, columns) {
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = columns.map((c) => `<th>${escHtml(c.label)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        '<tr>' +
        columns.map((c) => `<td>${escHtml(toCell(c.render ? c.render(row[c.key], row) : row[c.key]))}</td>`).join('') +
        '</tr>'
    )
    .join('');
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${head}</tr></thead>` +
    `<tbody>${body}</tbody></table></body></html>`;
  triggerDownload(new Blob([html], { type: 'application/vnd.ms-excel' }), `${baseName}-${timestamp()}.xls`);
}

/** Print the page (sidebar/header hidden via @media print) → Save as PDF. */
export function exportPDF() {
  window.print();
}
