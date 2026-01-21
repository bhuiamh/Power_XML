import * as XLSX from 'xlsx';
import type { Diff } from '../workers/xmlDiffWorker';

export function exportToCSV(diffs: Diff[], fileName: string = 'xml-comparison-report') {
  const headers = ['Path', 'Status', 'Left Value', 'Right Value'];
  const rows = diffs.map((diff) => [
    diff.path,
    diff.change.charAt(0).toUpperCase() + diff.change.slice(1),
    diff.leftValue ?? '—',
    diff.rightValue ?? '—'
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportToExcel(diffs: Diff[], fileName: string = 'xml-comparison-report') {
  const data = diffs.map((diff) => ({
    Path: diff.path,
    Status: diff.change.charAt(0).toUpperCase() + diff.change.slice(1),
    'Left Value': diff.leftValue ?? '—',
    'Right Value': diff.rightValue ?? '—'
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Comparison Results');
  
  // Auto-size columns
  const maxWidth = 50;
  const colWidths = [
    { wch: Math.min(data.reduce((max, row) => Math.max(max, (row.Path?.length || 0)), 0) + 2, maxWidth) },
    { wch: 12 },
    { wch: Math.min(data.reduce((max, row) => Math.max(max, (row['Left Value']?.length || 0)), 0) + 2, maxWidth) },
    { wch: Math.min(data.reduce((max, row) => Math.max(max, (row['Right Value']?.length || 0)), 0) + 2, maxWidth) }
  ];
  worksheet['!cols'] = colWidths;

  // Remove page numbers from Excel
  worksheet['!printOptions'] = {};
  if (!worksheet['!margins']) {
    worksheet['!margins'] = {};
  }
  // Disable header/footer that might show page numbers
  const wsProps = worksheet['!printOptions'] as any;
  wsProps.horizontalCentered = false;
  wsProps.verticalCentered = false;

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

