import * as vscode from 'vscode';
import { detectSourceKind } from './multiSourceAnalyzer';
import { renderDspfAsHtml } from './dspfRenderer';

interface PfColumn {
  name: string;
  type: string;
  length: number;
  columnHeading?: string;
}

export async function openSourceVisualization(doc: vscode.TextDocument): Promise<void> {
  const content = doc.getText();
  const sourceKind = detectSourceKind(doc.uri.toString(true), content);

  if (sourceKind !== 'DSPF_DDS' && sourceKind !== 'PF_DDS') {
    vscode.window.showWarningMessage('RPGenius: Visualization currently supports DDS DSPF and PF sources.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'rpgeniusVisualization',
    `RPGenius Preview: ${doc.fileName.split('/').pop() ?? 'source'}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  panel.webview.html = sourceKind === 'DSPF_DDS'
    ? renderDspfAsHtml(content)
    : buildPfHtml(content);
}

function buildPfHtml(content: string): string {
  const columns = parsePfColumns(content);
  const headers = columns.map((c) => `<th>${escapeHtml(c.columnHeading || c.name)}</th>`).join('');
  const sampleRow = columns
    .map((c) => `<td>${escapeHtml(sampleValue(c))}</td>`)
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; background: #f6f8fb; color: #1c2733; }
    .wrap { padding: 16px; }
    .title { margin-bottom: 12px; font-size: 14px; color: #334155; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: #ffffff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08); }
    th, td { border: 1px solid #d7dee8; padding: 8px 10px; font-size: 12px; text-align: left; }
    th { background: #eaf1f8; position: sticky; top: 0; font-weight: 600; }
    .meta { margin-top: 12px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">PF/PF38 Tabular Preview (inferred from DDS field definitions)</div>
    <table>
      <thead><tr>${headers || '<th>No fields detected</th>'}</tr></thead>
      <tbody>
        <tr>${sampleRow || '<td>-</td>'}</tr>
        <tr>${sampleRow || '<td>-</td>'}</tr>
        <tr>${sampleRow || '<td>-</td>'}</tr>
      </tbody>
    </table>
    <div class="meta">Note: Data rows are synthetic placeholders for structure review. Column headings from COLHDG keywords where available.</div>
  </div>
</body>
</html>`;
}

function parsePfColumns(content: string): PfColumn[] {
  const lines = content.split(/\r?\n/);
  const columns: PfColumn[] = [];

  for (const line of lines) {
    if (line.length < 34 || line[5]?.toUpperCase() !== 'A') {
      continue;
    }

    const name = line.substring(18, 28).trim().toUpperCase();
    if (!name) {
      continue;
    }

    const typeToken = line.substring(28, 30).trim().toUpperCase();
    const lengthToken = line.substring(30, 34).trim();
    const length = Number.parseInt(lengthToken, 10);

    // Extract COLHDG (Column Heading) from DDS keywords
    const colhdgMatch = /COLHDG\s*\(\s*'([^']*)'\s*'?([^']*)?\s*'?([^']*)?\s*\)/i.exec(line.toUpperCase());
    const columnHeading = colhdgMatch
      ? colhdgMatch
          .slice(1)
          .filter(Boolean)
          .join(' / ')
      : undefined;

    columns.push({
      name,
      type: decodeDdsType(typeToken),
      length: Number.isNaN(length) ? 10 : length,
      columnHeading,
    });
  }

  return dedupeColumns(columns);
}

function dedupeColumns(columns: PfColumn[]): PfColumn[] {
  const seen = new Set<string>();
  const out: PfColumn[] = [];
  for (const col of columns) {
    if (seen.has(col.name)) {
      continue;
    }
    seen.add(col.name);
    out.push(col);
  }
  return out;
}

function decodeDdsType(typeToken: string): string {
  switch (typeToken) {
    case 'A':
      return 'CHAR';
    case 'P':
      return 'PACKED';
    case 'S':
      return 'ZONED';
    case 'B':
      return 'BINARY';
    case 'L':
      return 'DATE';
    case 'T':
      return 'TIME';
    case 'Z':
      return 'TIMESTAMP';
    default:
      return typeToken || 'UNKNOWN';
  }
}

function sampleValue(column: PfColumn): string {
  if (column.type === 'CHAR') {
    return `sample_${column.name.toLowerCase()}`.slice(0, Math.max(1, Math.min(column.length, 20)));
  }
  if (column.type === 'DATE') {
    return '2026-04-15';
  }
  if (column.type === 'TIME') {
    return '10:30:00';
  }
  if (column.type === 'TIMESTAMP') {
    return '2026-04-15-10.30.00';
  }
  return '0';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
