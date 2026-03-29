/**
 * Export utilities — PDF, Excel, HTML.
 *
 * Mirrors Delphi export functionality:
 *   - PDF: grid data as tables (jsPDF + jspdf-autotable)
 *   - Excel: grid data as .xlsx (SheetJS)
 *   - HTML: grid data as styled HTML table
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportColumn {
  header: string;
  field: string;
  width?: number; // PDF column width hint
}

interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

// ─── Save Dialog Helpers ──────────────────────────────────────────────────────

async function pickSavePath(
  title: string,
  defaultName: string,
  filters: SaveDialogFilter[]
): Promise<string | null> {
  return window.sysmonApi.dialog.saveFile({
    title,
    defaultPath: defaultName,
    filters,
  });
}

async function writeFile(filePath: string, data: Uint8Array): Promise<void> {
  await window.sysmonApi.fs.writeFile(filePath, data);
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

export async function exportToPdf(
  title: string,
  columns: ExportColumn[],
  rows: Record<string, any>[],
  defaultFileName: string = 'export.pdf'
): Promise<boolean> {
  const filePath = await pickSavePath('Export to PDF', defaultFileName, [
    { name: 'PDF Files', extensions: ['pdf'] },
  ]);
  if (!filePath) return false;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Title
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(title, 40, 30);

  // Subtitle with date
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Exported: ${new Date().toLocaleString()}`, 40, 44);

  // Table
  const head = [columns.map((c) => c.header)];
  const body = rows.map((row) => columns.map((c) => String(row[c.field] ?? '')));

  autoTable(doc, {
    startY: 55,
    head,
    body,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 80], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 20, right: 20 },
    didDrawPage: (data) => {
      // Footer with page number
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        doc.internal.pageSize.getWidth() - 60,
        doc.internal.pageSize.getHeight() - 10
      );
    },
  });

  const pdfBytes = doc.output('arraybuffer');
  await writeFile(filePath, new Uint8Array(pdfBytes));
  return true;
}

// ─── PDF Export with Diagram Image ────────────────────────────────────────────

export async function exportDiagramToPdf(
  title: string,
  diagramElement: HTMLElement,
  defaultFileName: string = 'diagram.pdf'
): Promise<boolean> {
  const filePath = await pickSavePath('Export Diagram to PDF', defaultFileName, [
    { name: 'PDF Files', extensions: ['pdf'] },
  ]);
  if (!filePath) return false;

  // Use html2canvas-style capture via canvas
  // ReactFlow renders to a div; we capture it as SVG data or use a canvas snapshot
  const { default: html2canvas } = await import('html2canvas');

  const canvas = await html2canvas(diagramElement, {
    backgroundColor: '#111827',
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  // Fit to page
  const doc = new jsPDF({
    orientation: imgWidth > imgHeight ? 'landscape' : 'portrait',
    unit: 'px',
    format: [imgWidth / 2 + 40, imgHeight / 2 + 80],
  });

  // Title
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(title, 20, 25);

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Exported: ${new Date().toLocaleString()}`, 20, 38);

  // Image
  doc.addImage(imgData, 'PNG', 20, 50, imgWidth / 2, imgHeight / 2);

  const pdfBytes = doc.output('arraybuffer');
  await writeFile(filePath, new Uint8Array(pdfBytes));
  return true;
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

export async function exportToExcel(
  sheetName: string,
  columns: ExportColumn[],
  rows: Record<string, any>[],
  defaultFileName: string = 'export.xlsx'
): Promise<boolean> {
  const filePath = await pickSavePath('Export to Excel', defaultFileName, [
    { name: 'Excel Files', extensions: ['xlsx'] },
  ]);
  if (!filePath) return false;

  // Build worksheet data: header row + data rows
  const wsData = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => row[c.field] ?? '')),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws['!cols'] = columns.map((c) => ({ wch: c.width || Math.max(c.header.length, 12) }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

  const xlsxBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await writeFile(filePath, new Uint8Array(xlsxBytes));
  return true;
}

// ─── HTML Export ──────────────────────────────────────────────────────────────

export async function exportToHtml(
  title: string,
  columns: ExportColumn[],
  rows: Record<string, any>[],
  defaultFileName: string = 'export.html'
): Promise<boolean> {
  const filePath = await pickSavePath('Export to HTML', defaultFileName, [
    { name: 'HTML Files', extensions: ['html', 'htm'] },
  ]);
  if (!filePath) return false;

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const headerCells = columns.map((c) => `<th>${escHtml(c.header)}</th>`).join('');
  const bodyRows = rows
    .map(
      (row) =>
        '<tr>' +
        columns.map((c) => `<td>${escHtml(String(row[c.field] ?? ''))}</td>`).join('') +
        '</tr>'
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
  body { font-family: Segoe UI, Tahoma, sans-serif; margin: 20px; background: #fff; color: #333; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th { background: #3c3c50; color: #fff; padding: 6px 10px; text-align: left; font-weight: 600; }
  td { padding: 5px 10px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) { background: #f5f5fa; }
  tr:hover { background: #e8e8f0; }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
<div class="meta">Exported: ${new Date().toLocaleString()} &mdash; ${rows.length.toLocaleString()} rows</div>
<table>
<thead><tr>${headerCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
</body>
</html>`;

  const encoder = new TextEncoder();
  await writeFile(filePath, encoder.encode(html));
  return true;
}
