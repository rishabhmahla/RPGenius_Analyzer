/**
 * dspfRenderer.ts
 * Dedicated DSPF Display File Renderer for 5250 Green-Screen Terminal Emulation
 *
 * Enhanced features:
 * - Record format-aware DSPF parsing
 * - Field position, type, and display attribute parsing
 * - Conditional indicator visibility markers
 * - Input/BOTH/OUTPUT placeholders
 * - Constant text parsing and rendering
 * - Subfile group preview with replicated rows
 */

interface DspfFieldDef {
  name: string;
  row: number;
  col: number;
  length: number;
  type: 'INPUT' | 'OUTPUT' | 'BOTH' | 'CONSTANT' | 'HIDDEN';
  isNumeric?: boolean;
  attributes: {
    reverse?: boolean;
    underline?: boolean;
    bold?: boolean;
    blink?: boolean;
    invisible?: boolean;
    protected?: boolean;
    bright?: boolean;
    conditional?: boolean;
    hidden?: boolean;
    color?: string;
  };
  condition?: string;
  displayText?: string;
}

interface DspfRecord {
  name: string;
  fields: DspfFieldDef[];
  location: number;
  sflType?: 'SFL' | 'SFLCTL';
  sflName?: string;
  sflPage?: number;
  sflSize?: number;
}

export function parseDspfContent(content: string): DspfRecord[] {
  const lines = content.split(/\r?\n/);
  const records: Map<string, DspfRecord> = new Map();
  let currentRecord = 'MAIN';

  records.set(currentRecord, { name: currentRecord, fields: [], location: 0 });

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.length < 7) {
      continue;
    }

    const spec = line[5]?.toUpperCase();
    if (spec !== 'A') {
      continue;
    }

    const payload = line.toUpperCase();
    const recordMatch = /\bR\s+([A-Z0-9_#$@]+)/i.exec(payload);
    if (recordMatch) {
      currentRecord = recordMatch[1];
      if (!records.has(currentRecord)) {
        records.set(currentRecord, { name: currentRecord, fields: [], location: idx });
      }
      parseRecordProperties(records.get(currentRecord)!, payload);
      continue;
    }

    if (!records.has(currentRecord)) {
      records.set(currentRecord, { name: currentRecord, fields: [], location: idx });
    }

    const record = records.get(currentRecord)!;
    const field = parseDspfField(line, payload);
    if (field) {
      record.fields.push(field);
    } else {
      parseRecordProperties(record, payload);
    }
  }

  return Array.from(records.values());
}

function parseDspfField(line: string, payload: string): DspfFieldDef | undefined {
  const name = line.substring(18, 28).trim().toUpperCase();
  const specialText = extractSpecialFieldText(payload);
  const displayText = extractQuotedText(line) || specialText;
  const condition = extractCondition(payload);
  const attributes = parseDspatr(payload);
  const position = parseRowCol(payload);
  const length = determineFieldLength(payload, !!name, displayText);
  const type = determineFieldType(payload, !!displayText, name, !!specialText);
  const isNumeric = determineIfNumeric(payload);

  if (!name && type !== 'CONSTANT' && !position) {
    return undefined;
  }

  const field: DspfFieldDef = {
    name: name || displayText || '<CONST>',
    row: position?.row ?? 0,
    col: position?.col ?? 0,
    length: Math.max(1, length),
    type,
    isNumeric,
    attributes,
    condition,
    displayText,
  };

  if (type === 'CONSTANT' && displayText) {
    field.name = displayText;
  }

  if (condition) {
    field.attributes.conditional = true;
  }
  if (type === 'HIDDEN') {
    field.attributes.hidden = true;
  }

  if (/\bPROTECT\b|\bPROT\b/i.test(payload)) {
    field.attributes.protected = true;
  }

  return field;
}

function determineIfNumeric(payload: string): boolean {
  return /\b[0-9]+P\b|\bPACKED\b|\bSIGN\b|\b[0-9]+S\b|\bZONED\b|\bFLOAT\b|\bNUMERIC\b/i.test(payload);
}

function parseRecordProperties(record: DspfRecord, payload: string): void {
  const sflCtlMatch = /\bSFLCTL\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i.exec(payload);
  const sflNameMatch = /\bSFL\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i.exec(payload);

  if (sflCtlMatch) {
    record.sflType = 'SFLCTL';
    record.sflName = sflCtlMatch[1];
  } else if (sflNameMatch) {
    record.sflType = 'SFL';
    record.sflName = sflNameMatch[1];
  } else if (!record.sflType && /\bSFL\b/i.test(payload) && !/\bSFLPAG\b|\bSFLSIZ\b|\bSFLDSP\b|\bSFLCLR\b|\bSFLEND\b/i.test(payload)) {
    record.sflType = 'SFL';
    record.sflName = record.name;
  }

  const sflpagMatch = /\bSFLPAG\s*\(\s*(\d+)\s*\)/i.exec(payload);
  if (sflpagMatch) {
    record.sflPage = parseInt(sflpagMatch[1], 10);
  }

  const sflsizMatch = /\bSFLSIZ\s*\(\s*(\d+)\s*\)/i.exec(payload);
  if (sflsizMatch) {
    record.sflSize = parseInt(sflsizMatch[1], 10);
  }
}

function extractQuotedText(line: string): string | undefined {
  const matches = line.match(/'([^']*)'/g);
  if (!matches) {
    return undefined;
  }
  return matches.map(match => match.slice(1, -1)).join(' ');
}

function determineFieldLength(payload: string, hasName: boolean, displayText?: string): number {
  if (displayText) {
    return displayText.length;
  }

  const trimmed = payload.trim();
  const positionMatch = /(\d{1,3})\s+(\d{1,3})\s*(?:'[^']*')?\s*$/i.exec(trimmed);
  const prefix = positionMatch ? trimmed.slice(0, positionMatch.index).trim() : trimmed;
  const lengthMatch = /\b(\d{1,3})\b/.exec(prefix);
  if (lengthMatch) {
    return parseInt(lengthMatch[1], 10);
  }

  if (hasName) {
    return Math.max(1, trimmed.length);
  }

  return 1;
}

function determineFieldType(payload: string, hasText: boolean, name: string, hasSpecialText?: boolean): DspfFieldDef['type'] {
  if (hasText || hasSpecialText) {
    return 'CONSTANT';
  }

  if (/\bHIDDEN\b|\bHI\b/i.test(payload)) {
    return 'HIDDEN';
  }

  const usageMatch = /\b\d*([OIB])\b/i.exec(payload);
  if (usageMatch) {
    switch (usageMatch[1].toUpperCase()) {
      case 'I':
        return 'INPUT';
      case 'B':
        return 'BOTH';
      case 'O':
      default:
        return 'OUTPUT';
    }
  }

  if (/\bBOTH\b/i.test(payload)) {
    return 'BOTH';
  }

  if (/\bINPUT\b/i.test(payload)) {
    return 'INPUT';
  }

  if (/\bOUTPUT\b/i.test(payload)) {
    return 'OUTPUT';
  }

  if (name) {
    return 'OUTPUT';
  }

  return 'CONSTANT';
}

function parseDspatr(payload: string): DspfFieldDef['attributes'] {
  const attrs: DspfFieldDef['attributes'] = {};
  const dspatrMatch = /\bDSPATR\s*\(\s*([^)]+)\s*\)/i.exec(payload);
  if (dspatrMatch) {
    const attrList = dspatrMatch[1].toUpperCase();
    if (/RI|REVERSE/.test(attrList)) attrs.reverse = true;
    if (/UL|UNDERLINE/.test(attrList)) attrs.underline = true;
    if (/BL|BLINK/.test(attrList)) attrs.blink = true;
    if (/BR|BRIGHT/.test(attrList)) {
      attrs.bright = true;
      attrs.bold = true;
    }
    if (/HI|INVISIBLE/.test(attrList)) attrs.invisible = true;
    const colorMatch = /COLOR\s*\(\s*([A-Z]+)\s*\)/i.exec(attrList);
    if (colorMatch) {
      attrs.color = colorToCss(colorMatch[1]);
    }
  }

  const payloadColorMatch = /\bCOLOR\s*\(\s*([A-Z]+)\s*\)/i.exec(payload);
  if (payloadColorMatch) {
    attrs.color = colorToCss(payloadColorMatch[1]);
  }

  if (/\bREVERSE\b|\bRI\b/i.test(payload)) attrs.reverse = true;
  if (/\bUNDERLINE\b|\bUL\b/i.test(payload)) attrs.underline = true;
  if (/\bBLINK\b|\bBL\b/i.test(payload)) attrs.blink = true;
  if (/\bBRIGHT\b|\bBR\b/i.test(payload)) {
    attrs.bright = true;
    attrs.bold = true;
  }
  if (/\bINVISIBLE\b|\bHI\b/i.test(payload)) attrs.invisible = true;
  return attrs;
}

function colorToCss(colorName: string): string {
  switch (colorName.toUpperCase()) {
    case 'BLACK': return '#000000';
    case 'BLUE': return '#3b82f6';
    case 'RED': return '#ef4444';
    case 'GREEN': return '#22c55e';
    case 'YELLOW': return '#facc15';
    case 'CYAN': return '#06b6d4';
    case 'MAGENTA': return '#db2777';
    case 'WHITE': return '#ffffff';
    case 'BROWN': return '#a0522d';
    case 'ORANGE': return '#f97316';
    default:
      return colorName.toLowerCase();
  }
}

function extractColhdg(payload: string): string | undefined {
  const match = /COLHDG\s*\(\s*'([^']*)'\s*'?([^']*)?\s*'?([^']*)?\s*\)/i.exec(payload);
  if (!match) {
    return undefined;
  }
  return match.slice(1).filter(Boolean).join(' / ');
}

function extractEditmask(payload: string): string | undefined {
  const match = /EDTMSK\s*\(\s*'([^']*)'\s*\)/i.exec(payload);
  return match ? match[1] : undefined;
}

function extractEditcode(payload: string): string | undefined {
  const match = /EDTCDE\s*\(\s*'?([A-Z0-9])'?\s*\)/i.exec(payload);
  return match ? match[1] : undefined;
}

function extractSpecialFieldText(payload: string): string | undefined {
  const keyword = payload.match(/\b(DATE|TIME|USER|TIMESTAMP)\b/i);
  if (!keyword) {
    return undefined;
  }

  switch (keyword[1].toUpperCase()) {
    case 'DATE':
      return 'DATE';
    case 'TIME':
      return 'TIME';
    case 'USER':
      return 'USER';
    case 'TIMESTAMP':
      return 'TIMESTAMP';
  }
  return undefined;
}

function extractCondition(payload: string): string | undefined {
  const match = /(?:IF|WHEN)\s*\(?\s*([A-Z0-9_#$@]+)\s*\)?/i.exec(payload);
  return match ? match[1] : undefined;
}

function parseRowCol(payload: string): { row: number; col: number } | undefined {
  const keywordMatch = /\bPOS\s*\(\s*(\d+)\s+(\d+)\s*\)|\bLINE\s*\(\s*(\d+)\s*\).*?\bCOLUMN\s*\(\s*(\d+)\s*\)/i.exec(payload);
  if (keywordMatch) {
    if (keywordMatch[1] && keywordMatch[2]) {
      return { row: parseInt(keywordMatch[1], 10), col: parseInt(keywordMatch[2], 10) };
    }
    return { row: parseInt(keywordMatch[3], 10), col: parseInt(keywordMatch[4], 10) };
  }

  const digits = (payload.match(/\b\d{1,3}\b/g) || []).map((value) => parseInt(value, 10));
  if (digits.length >= 2) {
    const row = digits[digits.length - 2];
    const col = digits[digits.length - 1];
    if (row >= 1 && row <= 24 && col >= 1 && col <= 80) {
      return { row, col };
    }
  }

  const numericMatch = /(\d{1,3})\s+(\d{1,3})\s*(?:'[^']*')?\s*$/i.exec(payload);
  if (numericMatch) {
    return { row: parseInt(numericMatch[1], 10), col: parseInt(numericMatch[2], 10) };
  }

  return undefined;
}

interface RenderPlanItem {
  record: DspfRecord;
  repeatCount: number;
  rowIncrement: number;
}

function buildRenderPlan(records: DspfRecord[], selectedName: string): RenderPlanItem[] {
  const selected = records.find(r => r.name === selectedName);
  if (!selected) {
    return records.map(record => ({ record, repeatCount: 1, rowIncrement: 0 }));
  }

  if (selected.sflType === 'SFL' || selected.sflType === 'SFLCTL') {
    const groupName = selected.sflType === 'SFL' ? selected.name : selected.sflName ?? selected.name;
    const related = records.filter(r => r.name === groupName || r.sflName === groupName);
    const body = related.find(r => r.sflType === 'SFL' || r.name === groupName);
    const control = related.find(r => r.sflType === 'SFLCTL');
    const rows = selected.sflPage ?? selected.sflSize ?? control?.sflPage ?? control?.sflSize ?? body?.sflPage ?? body?.sflSize ?? 3;
    const plan: RenderPlanItem[] = [];
    if (control) {
      plan.push({ record: control, repeatCount: 1, rowIncrement: 0 });
    }
    if (body) {
      plan.push({ record: body, repeatCount: rows, rowIncrement: 1 });
    }
    if (plan.length > 0) {
      return plan;
    }
  }

  return [{ record: selected, repeatCount: 1, rowIncrement: 0 }];
}

export function renderDspfAsHtml(content: string, selectedRecordName?: string): string {
  const records = parseDspfContent(content);
  const renderPlan = selectedRecordName
    ? buildRenderPlan(records, selectedRecordName)
    : records.map(record => ({ record, repeatCount: 1, rowIncrement: 0 }));

  const ROWS = 24;
  const COLS = 80;
  const matrix: Array<Array<{ char: string; type: string; attrs: DspfFieldDef['attributes'] }>> = Array.from(
    { length: ROWS },
    () =>
      Array.from({ length: COLS }, () => ({
        char: ' ',
        type: 'text',
        attrs: {} as DspfFieldDef['attributes'],
      }))
  );
  const attrMatrix: Array<Array<DspfFieldDef['attributes']>> = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({}))
  );

  for (const planItem of renderPlan) {
    for (let copy = 0; copy < planItem.repeatCount; copy++) {
      const rowOffset = planItem.rowIncrement * copy;
      renderRecord(matrix, attrMatrix, planItem.record, rowOffset);
    }
  }

  const screenHtml = matrix
    .map((row, rowIdx) => {
      let rowHtml = '';
      let currentSpan = '';
      let currentAttrs: DspfFieldDef['attributes'] & { type?: string } = {};

      const flushSpan = () => {
        if (currentSpan) {
          const classes = getAttributeClasses(currentAttrs);
          const style = getAttributeStyle(currentAttrs);
          rowHtml += `<span class="${classes}" style="${style}">${escapeHtml(currentSpan)}</span>`;
          currentSpan = '';
          currentAttrs = {};
        }
      };

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cell = row[colIdx];
        const newAttrs = { ...attrMatrix[rowIdx][colIdx], type: cell.type };
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

  const previewTitle = selectedRecordName ? `Record format: ${selectedRecordName}` : '5250 Green-Screen Preview';
  const previewSubtitle = selectedRecordName
    ? 'Rendered from selected DSPF record format'
    : 'Rendered from complete DSPF source';

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
      background-color: rgba(0, 255, 0, 0.12);
      border-bottom: 1px solid #00ff00;
      padding: 0 1px;
    }
    span.output {
      color: #00ff00;
    }
    span.const {
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
    span.conditional {
      opacity: 0.7;
      border-bottom: 1px dashed #00ff00;
    }
    span.hidden {
      opacity: 0.45;
      color: #557755;
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
    .position-display {
      position: fixed;
      top: 10px;
      right: 20px;
      background: rgba(0, 255, 0, 0.15);
      border: 1px solid #00ff00;
      padding: 5px 10px;
      font-size: 12px;
      color: #00ff00;
      z-index: 1000;
      border-radius: 3px;
    }
    .refresh-button {
      position: fixed;
      top: 10px;
      right: 200px;
      background: rgba(0, 255, 0, 0.2);
      border: 1px solid #00ff00;
      padding: 5px 10px;
      font-size: 12px;
      color: #00ff00;
      cursor: pointer;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    .refresh-button:hover {
      background: rgba(0, 255, 0, 0.3);
    }
    .legend-input {
      border-bottom: 1px solid #00ff00;
      padding: 0 3px;
    }
    .preview-title {
      margin-bottom: 10px;
      font-size: 14px;
      color: #ffffff;
      font-weight: bold;
    }
    .preview-subtitle {
      margin-bottom: 15px;
      font-size: 11px;
      color: #9cff9c;
      opacity: 0.85;
    }
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>${style}</style>
  <script>
    let currentPanel = null;
    function updatePosition(e) {
      const rect = document.querySelector('.terminal-container').getBoundingClientRect();
      const col = Math.ceil((e.clientX - rect.left) / 7.8) - 1;
      const row = Math.ceil((e.clientY - rect.top) / 15.6) - 1;
      const display = document.getElementById('posDisplay');
      if (display && row >= 0 && row < 24 && col >= 0 && col < 80) {
        display.textContent = 'Row: ' + (row + 1) + ' Col: ' + (col + 1);
      }
    }
    function refreshScreen() {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'refresh' });
      }
    }
    window.addEventListener('mousemove', updatePosition);
  </script>
</head>
<body>
  <div id="posDisplay" class="position-display">Row: - Col: -</div>
  <button class="refresh-button" onclick="refreshScreen()">F5 Refresh</button>
  <div class="terminal-wrapper">
    <div>
      <div class="preview-title">${escapeHtml(previewTitle)}</div>
      <div class="preview-subtitle">${escapeHtml(previewSubtitle)}</div>
      <div class="terminal-container" onmousemove="updatePosition(event)">
        <div class="screen">
          ${screenHtml}
        </div>
      </div>
      <div class="legend">
        <strong>Field Styles:</strong>
        <div class="legend-item"><span class="legend-input">INPUT: 3 (numeric), I (char)</span></div>
        <div class="legend-item"><span>OUTPUT: 6 (numeric), O (char)</span></div>
        <div class="legend-item"><span class="reverse">BOTH: 9 (numeric), B (char)</span></div>
        <div class="legend-item"><span class="blink">REVERSE VIDEO, BLINK, COLORS applied</span></div>
        <div class="legend-item"><span class="conditional">CONDITIONAL / HIDDEN</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderRecord(
  matrix: Array<Array<{ char: string; type: string; attrs: DspfFieldDef['attributes'] }>>,
  attrMatrix: Array<Array<DspfFieldDef['attributes']>>,
  record: DspfRecord,
  rowOffset: number
): void {
  const ROWS = matrix.length;
  const COLS = matrix[0].length;

  for (const field of record.fields) {
    const baseRow = field.row - 1;
    const baseCol = field.col - 1;
    const r = baseRow + rowOffset;
    if (r < 0 || r >= ROWS || baseCol < 0 || baseCol >= COLS) {
      continue;
    }

    const content = field.type === 'CONSTANT' ? field.name : getFieldPlaceholder(field);
    for (let i = 0; i < field.length && baseCol + i < COLS; i++) {
      const char = content[i] ?? ' ';
      const cellType = field.type === 'INPUT' ? 'input' : field.type === 'CONSTANT' ? 'const' : 'output';
      matrix[r][baseCol + i] = { char, type: cellType, attrs: field.attributes };
      attrMatrix[r][baseCol + i] = field.attributes;
    }
  }
}

function getFieldPlaceholder(field: DspfFieldDef): string {
  if (field.type === 'CONSTANT') {
    return field.name.padEnd(field.length, ' ').substring(0, field.length);
  }

  if (field.isNumeric) {
    if (field.type === 'INPUT') {
      return '3'.repeat(field.length);
    } else if (field.type === 'BOTH') {
      return '9'.repeat(field.length);
    } else if (field.type === 'OUTPUT') {
      return '6'.repeat(field.length);
    }
    return '0'.repeat(field.length);
  }

  if (field.type === 'INPUT') {
    return 'I'.repeat(field.length);
  } else if (field.type === 'BOTH') {
    return 'B'.repeat(field.length);
  } else if (field.type === 'OUTPUT') {
    return 'O'.repeat(field.length);
  } else if (field.type === 'HIDDEN') {
    return 'H'.repeat(field.length);
  }

  return ' '.repeat(field.length);
}

function getAttributeClasses(attrs: DspfFieldDef['attributes'] & { type?: string }): string {
  const classes: string[] = [];
  if (attrs.type === 'input') classes.push('input');
  if (attrs.type === 'output') classes.push('output');
  if (attrs.type === 'const') classes.push('const');
  if (attrs.reverse) classes.push('reverse');
  if (attrs.underline) classes.push('underline');
  if (attrs.blink) classes.push('blink');
  if (attrs.bright) classes.push('bright');
  if (attrs.conditional) classes.push('conditional');
  if (attrs.hidden) classes.push('hidden');
  return classes.join(' ');
}

function getAttributeStyle(attrs: DspfFieldDef['attributes'] & { type?: string }): string {
  const styleParts: string[] = [];
  if (attrs.color) {
    styleParts.push(`color: ${attrs.color}`);
  }
  if (attrs.bold) {
    styleParts.push('font-weight: 700');
  }
  if (attrs.invisible) {
    styleParts.push('opacity: 0.2');
  }
  return styleParts.join('; ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
