import * as path from 'path';
import { parseRpgle } from './rpgleParser';
import { FileRef, ProgramCall, RpgleProgram, SourceLocation } from './models';

export type SourceKind = 'RPGLE' | 'SQLRPGLE' | 'CLLE' | 'CL38' | 'PF_DDS' | 'DSPF_DDS' | 'UNKNOWN';

export function detectSourceKind(filePath: string, content: string): SourceKind {
  const lower = filePath.toLowerCase();
  const upper = content.toUpperCase();

  if (lower.endsWith('.sqlrpgle') || lower.endsWith('.sqlrpg')) {
    return 'SQLRPGLE';
  }
  if (lower.endsWith('.clle')) {
    return 'CLLE';
  }
  if (lower.endsWith('.cl38') || lower.endsWith('.clp')) {
    return 'CL38';
  }
  if (lower.endsWith('.dspf')) {
    return 'DSPF_DDS';
  }
  if (lower.endsWith('.pf') || lower.endsWith('.pfdds')) {
    return 'PF_DDS';
  }

  if (/\bPGM\b/.test(upper) && /\bDCL\b/.test(upper)) {
    return 'CLLE';
  }
  if (/^.{5}A/m.test(content) && /\bR\s+\w+/i.test(content)) {
    if (/\bCF\d{2}\b|\bDSPATR\b|\bWINDOW\b|\bSFL\b/i.test(upper)) {
      return 'DSPF_DDS';
    }
    return 'PF_DDS';
  }

  if (upper.includes('**FREE') || upper.includes('DCL-PROC') || upper.includes('H ') || upper.includes('F ')) {
    return 'RPGLE';
  }

  return 'UNKNOWN';
}

export function analyzeSource(content: string, filePath: string): RpgleProgram {
  const kind = detectSourceKind(filePath, content);

  switch (kind) {
    case 'RPGLE': {
      const p = parseRpgle(content, filePath);
      p.sourceType = 'RPGLE';
      return p;
    }
    case 'SQLRPGLE': {
      const p = parseRpgle(content, filePath);
      p.sourceType = 'SQLRPGLE';
      return p;
    }
    case 'CLLE':
    case 'CL38':
      return parseCl(content, filePath, kind);
    case 'PF_DDS':
    case 'DSPF_DDS':
      return parseDds(content, filePath, kind);
    default: {
      const p = parseRpgle(content, filePath);
      p.sourceType = 'RPGLE';
      p.warnings.push({
        message: 'Source type not confidently identified; parsed using RPGLE parser fallback.',
        location: { line: 0, rawLine: '' },
      });
      return p;
    }
  }
}

function parseCl(content: string, filePath: string, kind: SourceKind): RpgleProgram {
  const lines = content.split(/\r?\n/);
  const programName = path.basename(filePath).split('.')[0].toUpperCase();

  const program: RpgleProgram = {
    programName,
    filePath,
    sourceType: kind,
    sourceFormat: 'FREE',
    totalLines: lines.length,
    copybooks: [],
    files: [],
    programCalls: [],
    procedures: [],
    dataStructures: [],
    ddsKeys: [],
    sqlStatements: [],
    cursors: [],
    variables: [],
    prototypes: [],
    warnings: [],
    fieldValidationIssues: [],
    parsedAt: new Date(),
  };

  lines.forEach((line, idx) => {
    const t = line.trim();
    const loc: SourceLocation = { line: idx, rawLine: line };
    if (!t || t.startsWith('/*') || t.startsWith('//*') || t.startsWith('//')) {
      return;
    }

    let m = /^DCL\s+VAR\(\s*&?(\w+)\s*\)\s+TYPE\(\s*\*?(\w+)\s*\)/i.exec(t);
    if (m) {
      program.variables.push({
        name: m[1].toUpperCase(),
        varType: m[2].toUpperCase(),
        isConstant: false,
        location: loc,
      });
      return;
    }

    m = /^(?:CALL|CALLPRC)\s+(?:PGM\(\s*)?([A-Z0-9_#$@]+)(?:\s*\))?/i.exec(t);
    if (m) {
      const callType: ProgramCall['callType'] = /^CALLPRC/i.test(t) ? 'CALLP' : 'CALL';
      program.programCalls.push({
        programName: m[1].toUpperCase(),
        callType,
        location: loc,
      });
      return;
    }

    m = /^OVRDBF\s+FILE\(\s*([A-Z0-9_#$@]+)\s*\).*?(?:TOFILE\(\s*([A-Z0-9_#$@\/]+)\s*\))?/i.exec(t);
    if (m) {
      const fileName = (m[2] ?? m[1]).split('/').pop() ?? m[1];
      const file: FileRef = {
        name: fileName.toUpperCase(),
        usage: 'U',
        fileType: 'DISK',
        keyed: false,
        isDisplayFile: false,
        isPrinterFile: false,
        location: loc,
      };

      const target = m[2] ?? '';
      if (target.includes('/')) {
        const [library, objectName] = target.toUpperCase().split('/');
        file.resolvedObject = {
          objectName,
          library,
          objectType: 'FILE',
        };
      }

      program.files.push(file);
    }
  });

  return program;
}

function parseDds(content: string, filePath: string, kind: SourceKind): RpgleProgram {
  const lines = content.split(/\r?\n/);
  const programName = path.basename(filePath).split('.')[0].toUpperCase();

  const program: RpgleProgram = {
    programName,
    filePath,
    sourceType: kind,
    sourceFormat: 'FIXED',
    totalLines: lines.length,
    copybooks: [],
    files: [],
    programCalls: [],
    procedures: [],
    dataStructures: [],
    ddsKeys: [],
    sqlStatements: [],
    cursors: [],
    variables: [],
    prototypes: [],
    warnings: [],
    fieldValidationIssues: [],
    parsedAt: new Date(),
  };

  const recordFields = new Map<string, Array<{
    name: string;
    type: string;
    line: number;
    attributes?: Record<string, string>;
    columnHeading?: string;
    length?: number;
    decimals?: number;
  }>>();
  let currentRecord = 'DEFAULT';

  lines.forEach((line, idx) => {
    const loc: SourceLocation = { line: idx, rawLine: line };

    if (line.length < 7) {
      return;
    }

    const spec = line[5]?.toUpperCase();

    // ── A-spec: Field definitions ──────────────────────────────────────────
    if (spec === 'A') {
      const name = line.substring(18, 28).trim().toUpperCase();
      const type = line.substring(28, 30).trim().toUpperCase();
      const payload = line.toUpperCase();

      const recordMatch = /\bR\s+([A-Z0-9_#$@]+)/.exec(payload);
      if (recordMatch) {
        currentRecord = recordMatch[1];
        if (!recordFields.has(currentRecord)) {
          recordFields.set(currentRecord, []);
        }
        return;
      }

      if (!name) {
        return;
      }

      if (!recordFields.has(currentRecord)) {
        recordFields.set(currentRecord, []);
      }

      // Extract field attributes from A-spec payload
      const attributes: Record<string, string> = {};
      let columnHeading: string | undefined;
      let length: number | undefined;
      let decimals: number | undefined;

      // COLHDG (Column Heading) - typically COLHDG('...' '...' '...')
      const colhdgMatch = /COLHDG\s*\(\s*'([^']*)'\s*'?([^']*)?\s*'?([^']*)?\s*\)/i.exec(payload);
      if (colhdgMatch) {
        columnHeading = colhdgMatch
          .slice(1)
          .filter(Boolean)
          .join(' / ');
        attributes['COLHDG'] = columnHeading;
      }

      // COLTXT (Column Text) - typically COLTXT('text')
      const coltxtMatch = /COLTXT\s*\(\s*'([^']*)'\s*\)/i.exec(payload);
      if (coltxtMatch) {
        attributes['COLTXT'] = coltxtMatch[1] ?? '';
      }

      // EDTCDE (Edit Code) - typically EDTCDE('mask') or EDTCDE(code)
      const edtcdeMatch = /EDTCDE\s*\(\s*'?([A-Z0-9])'?\s*\)/i.exec(payload);
      if (edtcdeMatch) {
        attributes['EDTCDE'] = edtcdeMatch[1] ?? '';
      }

      // ALIAS (Alternate name) - typically ALIAS(name)
      const aliasMatch = /ALIAS\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i.exec(payload);
      if (aliasMatch) {
        attributes['ALIAS'] = aliasMatch[1] ?? '';
      }

      // KEY (Key field) - presence indicates key field
      if (/\bKEY\b/i.test(payload)) {
        attributes['KEY'] = 'YES';
      }

      // UNIQUE (Unique key)
      if (/\bUNIQUE\b/i.test(payload)) {
        attributes['UNIQUE'] = 'YES';
      }

      // REF (Reference) - typically REF(filename)
      const refMatch = /REF\s*\(\s*([A-Z0-9_#$@.]+)\s*\)/i.exec(payload);
      if (refMatch) {
        attributes['REF'] = refMatch[1] ?? '';
      }

      // Extract length and decimals from type token (e.g., -P 0028 0002 for PACKED(28,2))
      if (type) {
        // Look for length/decimals on the same line or continuation
        const lenMatch = /^(.)-(\d+)(?:\s+(\d+))?/.exec(line.substring(30));
        if (lenMatch) {
          const lenStr = lenMatch[2];
          if (lenStr) {
            length = parseInt(lenStr, 10);
            if (lenMatch[3]) {
              decimals = parseInt(lenMatch[3], 10);
            }
          }
        }
      }

      recordFields.get(currentRecord)?.push({
        name,
        type: decodeDdsType(type),
        line: idx,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        columnHeading,
        length,
        decimals,
      });

      program.variables.push({
        name,
        varType: decodeDdsType(type),
        isConstant: false,
        location: loc,
      });
    }
    // ── K-spec: Key specifications ─────────────────────────────────────────
    else if (spec === 'K') {
      // K-spec: positions 18-28 = field name, position 30-32 = DESCEND indicator
      const keyFieldName = line.substring(18, 28).trim().toUpperCase();
      if (keyFieldName) {
        const descend = line.length > 30 && line[30]?.toUpperCase() === 'D';
        program.ddsKeys.push({
          name: `KEY_${program.ddsKeys.length + 1}`,
          keyFields: [keyFieldName],
          keyType: descend ? 'DESCEND' : 'ASCEND',
          location: loc,
        });
      }
    }
  });

  // Build data structures with enriched subfields
  for (const [recordName, fields] of recordFields.entries()) {
    program.dataStructures.push({
      name: recordName,
      dsType: 'DS',
      qualified: true,
      subfields: fields.map(f => ({
        name: f.name,
        type: f.type,
        location: { line: f.line, rawLine: lines[f.line] ?? '' },
        attributes: f.attributes,
        columnHeading: f.columnHeading,
        length: f.length,
        decimals: f.decimals,
      })),
      startLocation: { line: fields[0]?.line ?? 0, rawLine: lines[fields[0]?.line ?? 0] ?? '' },
    });
  }

  if (kind === 'DSPF_DDS') {
    program.files.push({
      name: programName,
      usage: 'I',
      fileType: 'WORKSTN',
      keyed: false,
      isDisplayFile: true,
      isPrinterFile: false,
      location: { line: 0, rawLine: lines[0] ?? '' },
    });
  } else {
    program.files.push({
      name: programName,
      usage: 'I',
      fileType: 'DISK',
      keyed: program.ddsKeys.length > 0,
      isDisplayFile: false,
      isPrinterFile: false,
      location: { line: 0, rawLine: lines[0] ?? '' },
    });
  }

  return program;
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
