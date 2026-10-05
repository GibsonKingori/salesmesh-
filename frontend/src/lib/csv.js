// Builds a CSV file in the browser and starts the download ("Export Report" use case)
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');

export function downloadCsv(filename, header, rows) {
  const text = toCsv(header, rows);
  // BOM so Excel opens KES amounts and names with accents correctly
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
