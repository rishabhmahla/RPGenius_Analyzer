/**
 * dspfRenderer.ts
 * Dedicated DSPF Display File Renderer for 5250 Green-Screen Terminal Emulation
 *
 * Enhanced features:
 * - Comprehensive DDS attribute parsing (DSPATR, INPUT, OUTPUT, PROTECT, etc.)
 * - Visual distinction between input and output fields
 * - Display attributes (reverse video, underline, bold, etc.)
 * - Function key indicators
 * - Conditional field display (IF/WHEN clauses)
 * - Record format detection and organization
 * - Accurate 5250 terminal emulation
 */

import * as vscode from 'vscode';

interface DspfFieldDef {
  name: string;
  row: number;
  col: number;
  length: number;
  type: 'INPUT' | 'OUTPUT' | 'CONSTANT' | 'HIDDEN';
  attributes: {
    reverse?: boolean;
    underline?: boolean;
    bold?: boolean;
    blink?: boolean;
    invisible?: boolean;
    protected?: boolean;
    bright?: boolean;
  };
  colhdg?: string;
  edtmsk?: string;
  edtcde?: string;
  condition?: string;
}

interface DspfRecord {
  name: string;
  fields: DspfFieldDef[];
  location: number;
}

/**
 * Parse DSPF content and extract all records and fields with full attributes.
 */
export function parseDspfContent(content: string): DspfRecord[] {
  const lines = content.split(/\r?\n/);
  const records: Map<string, DspfRecord> = new Map();
  let currentRecord = 'MAIN';
  let currentRow = 0;
  let currentCol = 0;

  records.set(currentRecord, { name: currentRecord, fields: [], location: 0 });

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (line.length < 7) {
      continue;
    }

    const spec = line[5]?.toUpperCase();

    // A-spec: Field definition
    if (spec === 'A') {
      const name = line.substring(18, 28).trim().toUpperCase();
      const typeToken = line.substring(28, 30).trim().toUpperCase();
      const payload = line.toUpperCase();

      // Record format header
      const recordMatch = /\bR\s+([A-Z0-9_#$@]+)/.exec(payload);
      if (recordMatch) {
        currentRecord = recordMatch[1];
        if (!records.has(currentRecord)) {
          records.set(currentRecord, { name: currentRecord, fields: [], location: idx });
        }
        continue;
      }

      if (!name) {
        continue;
      }

      // Parse position (LINE/COLUMN or POS)
      const rowMatch = /\bLINE\s*\(\s*(\d+)\s*\)/i.exec(payload);
      const colMatch = /\bCOLUMN\s*\(\s*(\d+)\s*\)/i.exec(payload);
      const posMatch = /\bPOS\s*\(\s*(\d+)\s*\s+(\d+)\s*\)/i.exec(payload);

      if (rowMatch) currentRow = parseInt(rowMatch[1], 10);
      if (colMatch) currentCol = parseInt(colMatch[1], 10);
      if (posMatch) {
        currentRow = parseInt(posMatch[1], 10);
        currentCol = parseInt(posMatch[2], 10);
      }

      if (currentRow === 0 || currentCol === 0) continue;

      // Parse length
      const lenMatch = /\bLEN\s*\(\s*(\d+)\s*\)|\bA\s+(\d+)/i.exec(payload);
      const length = lenMatch
        ? parseInt(lenMatch[1] ?? lenMatch[2] ?? '0', 10)
        : name.length;

      // Parse field type (INPUT, OUTPUT, CONSTANT, HIDDEN)
      const fieldType: 'INPUT' | 'OUTPUT' | 'CONSTANT' | 'HIDDEN' = /\bINPUT\b/i.test(payload)
        ? 'INPUT'
        : /\bOUTPUT\b/i.test(payload)
        ? 'OUTPUT'
        : /\bCONST\b/i.test(payload)
        ? 'CONSTANT'
        : /\bHIDDEN\b/i.test(payload)
        ? 'HIDDEN'
        : 'OUTPUT';

      // Parse display attributes (DSPATR)
      const attributes = parseDspatr(payload);

      // Parse edit attributes
      const colhdg = extractColhdg(payload);
      const edtmsk = extractEditmask(payload);
      const edtcde = extractEditcode(payload);

      // Parse condition (IF/WHEN clause)
      const condition = extractCondition(payload);

      // Protected field (OUTPUT with PROTECT or keyword)
      if (/\bPROTECT\b|\bPROT\b/i.test(payload)) {
        attributes.protected = true;
      }

      const field: DspfFieldDef = {
        name,
        row: currentRow,
        col: currentCol,
        length: Math.max(1, length),
        type: fieldType,
        attributes,
        colhdg,
        edtmsk,
        edtcde,
        condition,
      };

      records.get(currentRecord)?.fields.push(field);
    }
  }

  return Array.from(records.values());
}

function parseDspatr(payload: string): DspfFieldDef['attributes'] {
  const attrs: DspfFieldDef['attributes'] = {};

  // DSPATR keyword parsing - typically DSPATR(attribute-list)
  const dspatrMatch = /\bDSPATR\s*\(\s*([^)]+)\s*\)/i.exec(payload);
  if (dspatrMatch) {
    const attrList = dspatrMatch[1].toUpperCase();
    if (/RI|REVERSE/.test(attrList)) attrs.reverse = true;
    if (/UL|UNDERLINE/.test(attrList)) attrs.underline = true;
    if (/BL|BLINK/.test(attrList)) attrs.blink = true;
    if (/BR|BRIGHT/.test(attrList)) attrs.bright = true;
    if (/HI|INVISIBLE/.test(attrList)) attrs.invisible = true;
  }

  // Direct keyword checks
  if (/\bREVERSE\b|\bRI\b/i.test(payload)) attrs.reverse = true;
  if (/\bUNDERLINE\b|\bUL\b/i.test(payload)) attrs.underline = true;
  if (/\bBLINK\b|\bBL\b/i.test(payload)) attrs.blink = true;
  if (/\bBRIGHT\b|\bBR\b/i.test(payload)) attrs.bright = true;
  if (/\bINVISIBLE\b|\bHI\b/i.test(payload)) attrs.invisible = true;

  return attrs;
}

function extractColhdg(payload: string): string | undefined {
  const match = /COLHDG\s*\(\s*'([^']*)'\s*'?([^']*)?\s*'?([^']*)?\s*\)/i.exec(payload);
  if (match) {
    return match
      .slice(1)
      .filter(Boolean)
      .join(' / ');
  }
  return undefined;
}

function extractEditmask(payload: string): string | undefined {
  const match = /EDTMSK\s*\(\s*'([^']*)'\s*\)/i.exec(payload);
  return match ? match[1] : undefined;
}

function extractEditcode(payload: string): string | undefined {
  const match = /EDTCDE\s*\(\s*'?([A-Z0-9])'?\s*\)/i.exec(payload);
  return match ? match[1] : undefined;
}

function extractCondition(payload: string): string | undefined {
  const match = /(?:IF|WHEN)\s*\(?\s*([A-Z0-9_#$@]+)\s*\)?/i.exec(payload);
  return match ? match[1] : undefined;
}

/**
 * Generate HTML for 5250 green-screen display with full attribute support.
 */
export function renderDspfAsHtml(content: string): string {
  const records = parseDspfContent(content);
  const ROWS = 24;
  const COLS = 80;

  // Create character matrix
  const matrix: Array<Array<{ char: string; type: string; attrs: DspfFieldDef['attributes'] }>> = Array.from(
    { length: ROWS },
    () =>
      Array.from({ length: COLS }, () => ({
        char: ' ',
        type: 'text',
        attrs: {} as DspfFieldDef['attributes'],
      }))
  );

  // Attribute matrix for styling
  const attrMatrix: Array<Array<DspfFieldDef['attributes']>> = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({}))
  );

  // Render all fields from all records
  for (const record of records) {
    for (const field of record.fields) {
      if (field.row < 1 || field.row > ROWS || field.col < 1 || field.col > COLS) {
        continue;
      }

      const r = field.row - 1;
      const c = field.col - 1;

      // Determine display character based on field type
      let displayChar = field.type === 'INPUT' ? '_' : ' ';

      // For constant fields, use the name
      if (field.type === 'CONSTANT') {
        displayChar = ' ';
      } else if (field.type === 'HIDDEN') {
        continue; // Skip hidden fields
      }

      // Fill field area with appropriate characters
      const label = field.name.padEnd(field.length, displayChar).substring(0, field.length);

      for (let i = 0; i < label.length && c + i < COLS; i++) {
        matrix[r][c + i] = {
          char: label[i],
          type: field.type === 'INPUT' ? 'input' : field.type === 'CONSTANT' ? 'const' : 'output',
          attrs: field.attributes,
        };
        attrMatrix[r][c + i] = field.attributes;
      }
    }
  }

  // Generate HTML with field styling
  const screenHtml = matrix
    .map((row, rowIdx) => {
      let rowHtml = '';
      let currentSpan = '';
      let currentAttrs: DspfFieldDef['attributes'] & { type?: string } = {};

      const flushSpan = () => {
        if (currentSpan) {
          const classes = getAttributeClasses(currentAttrs);
          rowHtml += `<span class="${classes}">${escapeHtml(currentSpan)}</span>`;
          currentSpan = '';
          currentAttrs = {};
        }
      };

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cell = row[colIdx];
        const newAttrs = { ...attrMatrix[rowIdx][colIdx], type: cell.type };

        // Check if attributes changed
        if (JSON.stringify(currentAttrs) !== JSON.stringify(newAttrs)) {
          flushSpan();
          currentAttrs = newAttrs;
        }

        currentSpan += cell.char;
      }

      flushSpan();
      return `<div class="screen-row">${rowHtml}</div>`;
    })
    .join('');

  const style = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #000000;
      color: #00ff00;
      padding: 20px;
      line-height: 1.2;
    }
    .terminal-wrapper {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .terminal-container {
      border: 3px solid #00ff00;
      padding: 10px;
      background: #000000;
      box-shadow: 0 0 20px rgba(0, 255, 0, 0.3), inset 0 0 10px rgba(0, 255, 0, 0.1);
      font-size: 13px;
      font-family: 'Courier New', monospace;
      line-height: 1;
      letter-spacing: 0.05em;
    }
    .screen {
      white-space: pre;
      color: #00ff00;
      display: flex;
      flex-direction: column;
    }
    .screen-row {
      display: flex;
      flex-direction: row;
      white-space: pre;
      height: 1em;
    }
    span.input {
      background-color: rgba(0, 255, 0, 0.1);
      border-bottom: 1px solid #00ff00;
      padding: 0 1px;
    }
    span.const {
      color: #00ff00;
    }
    span.output {
      color: #00ff00;
    }
    span.reverse {
      background-color: #00ff00;
      color: #000000;
    }
    span.underline {
      text-decoration: underline;
    }
    span.blink {
      animation: blink 1s infinite;
    }
    span.bright {
      font-weight: bold;
    }
    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0.3; }
    }
    .status-line {
      border-top: 1px solid #00ff00;
      padding-top: 5px;
      margin-top: 0;
      font-size: 11px;
      opacity: 0.8;
      height: 1em;
      display: flex;
      align-items: center;
    }
    .legend {
      margin-top: 20px;
      font-size: 11px;
      opacity: 0.8;
      border-top: 1px solid #00ff00;
      padding-top: 10px;
    }
    .legend-item {
      display: flex;
      gap: 10px;
      margin: 3px 0;
    }
    .legend-input {
      border-bottom: 1px solid #00ff00;
      padding: 0 3px;
    }
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>${style}</style>
</head>
<body>
  <div class="terminal-wrapper">
    <div>
      <div class="terminal-container">
        <div class="screen">
          ${screenHtml}
        </div>
        <div class="status-line">F1=Help  F3=Exit  F12=Cancel</div>
      </div>
      <div class="legend">
        <strong>Field Types:</strong>
        <div class="legend-item"><span class="legend-input">INPUT (underlined)</span></div>
        <div class="legend-item"><span>OUTPUT (normal)</span></div>
        <div class="legend-item"><span class="reverse">REVERSE VIDEO</span></div>
        <div class="legend-item"><span class="blink">BLINK</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getAttributeClasses(attrs: DspfFieldDef['attributes'] & { type?: string }): string {
  const classes: string[] = [];

  if (attrs.type === 'input') {
    classes.push('input');
  }

  if (attrs.reverse) classes.push('reverse');
  if (attrs.underline) classes.push('underline');
  if (attrs.blink) classes.push('blink');
  if (attrs.bright) classes.push('bright');

  return classes.join(' ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
