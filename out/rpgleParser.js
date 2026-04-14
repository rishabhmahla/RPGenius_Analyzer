"use strict";
/**
 * rpgleParser.ts
 * Core RPGLE static analysis engine.
 *
 * Reads source code line-by-line and populates an RpgleProgram model.
 * Handles:
 *   - Full free-format (**FREE)
 *   - Fixed-format (column-positional)
 *   - Mixed (inline /FREE ... /END-FREE blocks)
 *   - Comments (// and column-7 *)
 *   - Multi-line SQL statements
 *   - Continuation lines
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRpgle = parseRpgle;
const path = __importStar(require("path"));
const R = __importStar(require("./regexRules"));
// ─── Parser Entry Point ───────────────────────────────────────────────────────
/**
 * Parse an RPGLE source string into a structured RpgleProgram model.
 *
 * @param source    - Full source code text
 * @param filePath  - Absolute path to the source file (used for metadata)
 */
function parseRpgle(source, filePath) {
    const lines = source.split(/\r?\n/);
    const programName = path.basename(filePath, path.extname(filePath)).toUpperCase();
    const program = {
        programName,
        filePath,
        sourceFormat: 'FIXED',
        totalLines: lines.length,
        copybooks: [],
        files: [],
        programCalls: [],
        procedures: [],
        dataStructures: [],
        sqlStatements: [],
        cursors: [],
        variables: [],
        prototypes: [],
        warnings: [],
        parsedAt: new Date(),
    };
    const state = {
        isFreeFormat: false,
        inInlineFree: false,
        inSqlBlock: false,
        sqlBuffer: '',
        sqlStartLine: 0,
        inProcedure: false,
        currentProc: null,
        inDS: false,
        currentDS: null,
        inPrototype: false,
        currentPR: null,
        inProcInterface: false,
    };
    // ── First-pass: detect source format ──────────────────────────────────────
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        if (R.RE_FREE_FORMAT_DIRECTIVE.test(lines[i])) {
            state.isFreeFormat = true;
            program.sourceFormat = 'FREE';
            break;
        }
    }
    // Check for mixed format (has both fixed H/F specs and /FREE blocks)
    if (!state.isFreeFormat) {
        const hasFreeBlocks = lines.some(l => R.RE_INLINE_FREE_START.test(l));
        if (hasFreeBlocks) {
            program.sourceFormat = 'MIXED';
        }
    }
    // ── Main parse loop ───────────────────────────────────────────────────────
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const rawLine = lines[lineNum];
        const loc = { line: lineNum, rawLine };
        // Track inline free blocks
        if (!state.isFreeFormat) {
            if (R.RE_INLINE_FREE_START.test(rawLine)) {
                state.inInlineFree = true;
                continue;
            }
            if (R.RE_INLINE_FREE_END.test(rawLine)) {
                state.inInlineFree = false;
                continue;
            }
        }
        const isFree = state.isFreeFormat || state.inInlineFree;
        // Skip blank lines
        if (rawLine.trim() === '') {
            continue;
        }
        // Skip comments
        if (isComment(rawLine, isFree)) {
            continue;
        }
        // Handle multi-line SQL accumulation
        if (state.inSqlBlock) {
            state.sqlBuffer += ' ' + rawLine.trim();
            if (rawLine.includes(';')) {
                flushSql(program, state);
            }
            continue;
        }
        // Dispatch to appropriate parser
        if (isFree) {
            parseFreeFormatLine(rawLine, loc, program, state);
        }
        else {
            parseFixedFormatLine(rawLine, loc, program, state);
        }
    }
    // Flush any unclosed SQL
    if (state.inSqlBlock && state.sqlBuffer.trim()) {
        program.warnings.push({
            message: 'Unterminated EXEC SQL block detected; flushed at end of file.',
            location: { line: state.sqlStartLine, rawLine: lines[state.sqlStartLine] ?? '' },
        });
        flushSql(program, state);
    }
    finalizeOpenBlocks(program, state, lines);
    return program;
}
// ─── Comment Detection ────────────────────────────────────────────────────────
function isComment(line, isFree) {
    if (isFree) {
        return R.RE_FREE_COMMENT.test(line);
    }
    // Fixed format: column 7 (index 6) is '*'
    // Also handle lines shorter than 7 chars that are clearly blank
    const stripped = line.trimEnd();
    if (stripped.length === 0) {
        return true;
    }
    // Check col 7 (* = comment)
    if (stripped.length >= 7 && stripped[6] === '*') {
        return true;
    }
    // Check for //-style even in fixed sections (some compilers allow it)
    if (R.RE_FREE_COMMENT.test(line)) {
        return true;
    }
    return false;
}
// ─── Free-Format Line Parser ──────────────────────────────────────────────────
function parseFreeFormatLine(line, loc, program, state) {
    const trimmed = line.trim();
    // /COPY or /INCLUDE
    let m = R.RE_COPY_SLASH.exec(trimmed);
    if (m) {
        parseCopybook(m, loc, program);
        return;
    }
    m = R.RE_COPY_IFS.exec(trimmed);
    if (m) {
        program.copybooks.push({
            library: '',
            member: m[1],
            location: loc,
        });
        return;
    }
    // DCL-F (file declaration)
    m = R.RE_DCL_F.exec(trimmed);
    if (m) {
        parseDclF(trimmed, m, loc, program);
        return;
    }
    // EXEC SQL
    m = R.RE_EXEC_SQL.exec(trimmed);
    if (m) {
        const sqlText = m[1].trim();
        state.sqlBuffer = sqlText;
        state.sqlStartLine = loc.line;
        state.inSqlBlock = true;
        if (sqlText.includes(';')) {
            flushSql(program, state);
        }
        return;
    }
    // CALL / CALLP / CALLB
    parseProgramCall(trimmed, loc, program);
    // DCL-PROC
    m = R.RE_DCL_PROC.exec(trimmed);
    if (m) {
        if (state.inProcedure && state.currentProc) {
            program.procedures.push(state.currentProc);
        }
        state.currentProc = {
            name: m[1],
            parameters: [],
            isExported: !!(m[2] && m[2].toLowerCase() === 'export'),
            startLocation: loc,
        };
        state.inProcedure = true;
        return;
    }
    // DCL-PI (procedure interface — captures return type)
    m = R.RE_DCL_PI.exec(trimmed);
    if (m) {
        if (state.currentProc && m[2]) {
            const rt = m[2].trim();
            if (rt.toUpperCase() !== '*N') {
                state.currentProc.returnType = rt;
            }
        }
        state.inProcInterface = true;
        return;
    }
    // END-PI
    if (R.RE_END_PI.test(trimmed)) {
        state.inProcInterface = false;
        return;
    }
    // DCL-PI parameter lines (lines inside DCL-PI...END-PI that have a name + type)
    if (state.inProcInterface && state.currentProc) {
        const param = parseProcParam(trimmed);
        if (param) {
            state.currentProc.parameters.push(param);
        }
        return;
    }
    // END-PROC
    if (R.RE_END_PROC.test(trimmed)) {
        if (state.currentProc) {
            state.currentProc.endLocation = loc;
            program.procedures.push(state.currentProc);
            state.currentProc = null;
        }
        state.inProcedure = false;
        return;
    }
    // DCL-DS
    m = R.RE_DCL_DS.exec(trimmed);
    if (m) {
        if (state.inDS && state.currentDS) {
            program.dataStructures.push(state.currentDS);
        }
        const likeM = R.RE_DCL_DS_LIKEDS.exec(trimmed);
        const isQualified = R.RE_DCL_DS_QUALIFIED.test(trimmed);
        const isTemplate = R.RE_DCL_DS_TEMPLATE.test(trimmed);
        const dsName = m[1];
        let dsType = 'DS';
        if (likeM) {
            dsType = 'LIKEDS';
        }
        else if (isTemplate) {
            dsType = 'TEMPLATE';
        }
        else if (isQualified) {
            dsType = 'QUALIFIED';
        }
        state.currentDS = {
            name: dsName,
            dsType,
            likeBase: likeM ? likeM[1] : undefined,
            qualified: isQualified,
            subfields: [],
            startLocation: loc,
        };
        state.inDS = true;
        return;
    }
    // DS subfield lines (inside DCL-DS...END-DS that are DCL-S-like or bare name+type)
    if (state.inDS && state.currentDS && !R.RE_END_DS.test(trimmed)) {
        const subfield = parseDsSubfield(trimmed, loc);
        if (subfield) {
            state.currentDS.subfields.push(subfield);
        }
    }
    // END-DS
    if (R.RE_END_DS.test(trimmed)) {
        if (state.currentDS) {
            state.currentDS.endLocation = loc;
            program.dataStructures.push(state.currentDS);
            state.currentDS = null;
        }
        state.inDS = false;
        return;
    }
    // DCL-S (standalone variable)
    m = R.RE_DCL_S.exec(trimmed);
    if (m) {
        const varName = m[1];
        const varType = m[2].trim().replace(/\s*;$/, '');
        const inzM = /Inz\s*\(\s*(.*?)\s*\)/i.exec(trimmed);
        program.variables.push({
            name: varName,
            varType,
            isConstant: false,
            initialValue: inzM ? inzM[1] : undefined,
            location: loc,
        });
        return;
    }
    // DCL-C (constant)
    m = R.RE_DCL_C.exec(trimmed);
    if (m) {
        program.variables.push({
            name: m[1],
            varType: 'CONST',
            isConstant: true,
            initialValue: m[2],
            location: loc,
        });
        return;
    }
    // DCL-PR (prototype)
    m = R.RE_DCL_PR.exec(trimmed);
    if (m) {
        if (state.inPrototype && state.currentPR) {
            program.prototypes.push(state.currentPR);
        }
        const extPgmM = R.RE_EXTPGM.exec(trimmed);
        const extProcM = R.RE_EXTPROC.exec(trimmed);
        state.currentPR = {
            name: m[1],
            externalName: extPgmM ? extPgmM[1] : (extProcM ? extProcM[1] : undefined),
            parameters: [],
            location: loc,
        };
        state.inPrototype = true;
        return;
    }
    // END-PR
    if (R.RE_END_PR.test(trimmed)) {
        if (state.currentPR) {
            program.prototypes.push(state.currentPR);
            state.currentPR = null;
        }
        state.inPrototype = false;
        return;
    }
    // Prototype parameter lines
    if (state.inPrototype && state.currentPR) {
        const param = parseProcParam(trimmed);
        if (param) {
            state.currentPR.parameters.push(param);
        }
    }
}
// ─── Fixed-Format Line Parser ─────────────────────────────────────────────────
/**
 * Fixed-format lines are column-positional.
 * Column 6 (index 5) = Spec type: H, F, D, I, C, O, P
 * We read this character to decide how to parse the rest.
 */
function parseFixedFormatLine(line, loc, program, state) {
    // Must be at least 7 chars to have a spec type
    if (line.length < 6) {
        return;
    }
    // Spec type is at column index 5 (after 5-char sequence field)
    // Some sources don't have a sequence field — tolerate by checking trimmed start
    const specType = line.length >= 6 ? line[5].toUpperCase() : '';
    const trimmed = line.trim();
    // /COPY directive (can appear in fixed format too)
    if (trimmed.toUpperCase().startsWith('/COPY') || trimmed.toUpperCase().startsWith('/INCLUDE')) {
        const m = R.RE_COPY_SLASH.exec(trimmed);
        if (m) {
            parseCopybook(m, loc, program);
        }
        return;
    }
    switch (specType) {
        case 'H': // Control spec — skip
            break;
        case 'F': // File spec
            parseFixedFspec(line, loc, program);
            break;
        case 'D': // Definition spec
            parseFixedDspec(line, loc, program, state);
            break;
        case 'C': // Calculation spec
            parseFixedCspec(line, loc, program, state);
            break;
        case 'P': // Procedure spec
            parseFixedPspec(line, loc, program, state);
            break;
        default:
            // Try free-format parsing as fallback for unrecognized lines
            // (handles mixed-format files where spec column isn't in position)
            parseFreeFormatLine(line, loc, program, state);
            break;
    }
}
// ─── Fixed F-Spec ─────────────────────────────────────────────────────────────
function parseFixedFspec(line, loc, program) {
    // cols 7-16: file name (index 6-15)
    // col 17: usage I/O/U/C (index 16)
    // col 35-42: device (index 34-41)
    if (line.length < 17) {
        return;
    }
    const rawName = line.substring(6, 16).trim().toUpperCase();
    const rawUsage = line.length >= 17 ? line[16].trim().toUpperCase() : '';
    const restLine = line.substring(17).toUpperCase();
    if (!rawName) {
        return;
    }
    // Determine device/file type
    let fileType = 'UNKNOWN';
    if (restLine.includes('DISK')) {
        fileType = 'DISK';
    }
    if (restLine.includes('WORKSTN')) {
        fileType = 'WORKSTN';
    }
    if (restLine.includes('PRINTER')) {
        fileType = 'PRINTER';
    }
    if (restLine.includes('SEQ')) {
        fileType = 'SEQ';
    }
    if (restLine.includes('SPECIAL')) {
        fileType = 'SPECIAL';
    }
    const usage = normalizeUsage(rawUsage);
    program.files.push({
        name: rawName,
        usage,
        fileType,
        keyed: isFixedFspecKeyed(restLine),
        isDisplayFile: fileType === 'WORKSTN',
        isPrinterFile: fileType === 'PRINTER',
        location: loc,
    });
}
// ─── Fixed D-Spec ─────────────────────────────────────────────────────────────
function parseFixedDspec(line, loc, program, state) {
    if (line.length < 24) {
        return;
    }
    // cols 7-21: name (index 6-20)
    // col 24: type S=standalone, DS=data structure, C=constant, PR=prototype
    const rawName = line.substring(6, 21).trim().toUpperCase();
    const typeArea = line.length >= 25 ? line.substring(22, 25).trim().toUpperCase() : '';
    const fullLine = line.toUpperCase();
    if (!rawName) {
        // Subfield — no name in first area
        if (state.inDS && state.currentDS) {
            const sfName = line.substring(6, 21).trim();
            if (sfName) {
                state.currentDS.subfields.push({ name: sfName, type: '', location: loc });
            }
        }
        return;
    }
    if (typeArea === 'DS' || typeArea.startsWith('DS')) {
        if (state.inDS && state.currentDS) {
            program.dataStructures.push(state.currentDS);
        }
        state.currentDS = {
            name: rawName,
            dsType: 'DS',
            qualified: fullLine.includes('QUALIFIED'),
            subfields: [],
            startLocation: loc,
        };
        state.inDS = true;
        return;
    }
    if (typeArea === 'S' || typeArea === 'S ') {
        program.variables.push({
            name: rawName,
            varType: extractFixedDType(line),
            isConstant: false,
            location: loc,
        });
        return;
    }
    if (typeArea === 'C' || typeArea === 'C ') {
        program.variables.push({
            name: rawName,
            varType: 'CONST',
            isConstant: true,
            location: loc,
        });
        return;
    }
    if (typeArea === 'PR' || typeArea.startsWith('PR')) {
        if (state.inPrototype && state.currentPR) {
            program.prototypes.push(state.currentPR);
        }
        const extPgmM = R.RE_EXTPGM.exec(line);
        state.currentPR = {
            name: rawName,
            externalName: extPgmM ? extPgmM[1] : undefined,
            parameters: [],
            location: loc,
        };
        state.inPrototype = true;
        return;
    }
    // If we're in a DS, treat as subfield
    if (state.inDS && state.currentDS) {
        state.currentDS.subfields.push({ name: rawName, type: extractFixedDType(line), location: loc });
    }
}
// ─── Fixed C-Spec ─────────────────────────────────────────────────────────────
/**
 * C-specs: calculation lines.
 * Op-code is in cols 26-35 (index 25-34).
 * Factor 1: cols 12-25 (index 11-24)
 * Factor 2: cols 36-49 (index 35-48)
 */
function parseFixedCspec(line, loc, program, state) {
    if (line.length < 26) {
        return;
    }
    const opCode = line.substring(25, 35).trim().toUpperCase();
    const factor2 = line.length >= 49 ? line.substring(35, 49).trim() : '';
    // EXEC SQL
    if (opCode === 'EXEC' && factor2.toUpperCase().startsWith('SQL')) {
        const sqlText = factor2.substring(3).trim();
        state.sqlBuffer = sqlText;
        state.sqlStartLine = loc.line;
        state.inSqlBlock = !sqlText.includes(';');
        if (!state.inSqlBlock) {
            flushSql(program, state);
        }
        return;
    }
    // CALL
    if (opCode === 'CALL') {
        const pgmName = factor2.replace(/['"]/g, '').trim();
        if (pgmName) {
            program.programCalls.push({ programName: pgmName, callType: 'CALL', location: loc });
        }
        return;
    }
    // CALLP
    if (opCode === 'CALLP') {
        const m = /(\w+)\s*[;(]?/.exec(factor2);
        if (m) {
            program.programCalls.push({ programName: m[1], callType: 'CALLP', location: loc });
        }
        return;
    }
    // CALLB
    if (opCode === 'CALLB') {
        const pgmName = factor2.replace(/['"]/g, '').trim();
        if (pgmName) {
            program.programCalls.push({ programName: pgmName, callType: 'CALLB', location: loc });
        }
    }
}
// ─── Fixed P-Spec ─────────────────────────────────────────────────────────────
function parseFixedPspec(line, loc, program, state) {
    const mBegin = R.RE_PSPEC_BEGIN.exec(line);
    if (mBegin) {
        if (state.inProcedure && state.currentProc) {
            program.procedures.push(state.currentProc);
        }
        state.currentProc = {
            name: mBegin[1].trim(),
            parameters: [],
            isExported: false,
            startLocation: loc,
        };
        state.inProcedure = true;
        return;
    }
    const mEnd = R.RE_PSPEC_END.exec(line);
    if (mEnd) {
        if (state.currentProc) {
            state.currentProc.endLocation = loc;
            program.procedures.push(state.currentProc);
            state.currentProc = null;
        }
        state.inProcedure = false;
    }
}
// ─── Shared Helpers ───────────────────────────────────────────────────────────
function parseCopybook(m, loc, program) {
    // m[1] = library (may be undefined), m[2] = member
    const library = m[1] ?? '';
    const member = m[2] ?? '';
    if (!member && !library) {
        return;
    }
    program.copybooks.push({ library, member, location: loc });
}
function parseDclF(trimmed, m, loc, program) {
    const name = m[1].toUpperCase();
    const usageStr = (m[2] ?? '').toUpperCase();
    const usage = resolveDclFUsage(usageStr);
    const deviceM = R.RE_DCL_F_DEVICE.exec(trimmed);
    const deviceStr = deviceM ? deviceM[1].toUpperCase() : 'UNKNOWN';
    let fileType = 'UNKNOWN';
    switch (deviceStr) {
        case 'DISK':
            fileType = 'DISK';
            break;
        case 'WORKSTN':
            fileType = 'WORKSTN';
            break;
        case 'PRINTER':
            fileType = 'PRINTER';
            break;
        case 'SEQ':
            fileType = 'SEQ';
            break;
        case 'SPECIAL':
            fileType = 'SPECIAL';
            break;
    }
    program.files.push({
        name,
        usage,
        fileType,
        keyed: R.RE_DCL_F_KEYED.test(trimmed),
        isDisplayFile: fileType === 'WORKSTN',
        isPrinterFile: fileType === 'PRINTER',
        location: loc,
    });
}
function parseProgramCall(trimmed, loc, program) {
    let m = R.RE_CALLB.exec(trimmed);
    if (m) {
        program.programCalls.push({ programName: m[1], callType: 'CALLB', location: loc });
        return;
    }
    m = R.RE_CALLP.exec(trimmed);
    if (m) {
        program.programCalls.push({ programName: m[1], callType: 'CALLP', location: loc });
        return;
    }
    m = R.RE_CALL_FREE.exec(trimmed);
    if (m) {
        // Avoid false positives like CALLP, CALLB already caught above
        // and avoid matching inside strings or comments
        const pgm = m[1].replace(/['"]/g, '');
        if (pgm && !pgm.match(/^(CALLP|CALLB)$/i)) {
            program.programCalls.push({ programName: pgm, callType: 'CALL', location: loc });
        }
    }
}
function parseProcParam(trimmed) {
    // A parameter line looks like: "  paramName   CHAR(10) Const;"
    // or just a type continuation. We try to extract name + type.
    const m = /^\s*(\w+)\s+(\w[\w()*:,\s]*?)(?:\s+(Const|Value)\b)?(?:\s*[:;].*)?$/i.exec(trimmed);
    if (!m) {
        return null;
    }
    const name = m[1];
    // Skip keywords that look like parameter names but aren't
    const keywords = new Set(['DCL-PI', 'DCL-PR', 'END-PI', 'END-PR', 'END-PROC', 'DCL-PROC']);
    if (keywords.has(name.toUpperCase())) {
        return null;
    }
    return {
        name,
        type: m[2].trim(),
        direction: m[3] ? m[3].toUpperCase() : 'REF',
    };
}
function parseDsSubfield(trimmed, loc) {
    // Subfield: bare "name    type;" or DCL-S-like
    const m = /^\s*(\w+)\s+(\w[\w()*:]*)\s*;?/.exec(trimmed);
    if (!m) {
        return null;
    }
    const keywords = new Set(['END-DS', 'DCL-DS', 'DCL-S', 'DCL-C', 'DCL-F']);
    if (keywords.has(m[1].toUpperCase())) {
        return null;
    }
    return { name: m[1], type: m[2], location: loc };
}
function extractFixedDType(line) {
    // Fixed D-spec: type is indicated by a single char at col 40 (index 39)
    // Lengths at cols 33-39 (index 32-38), decimals at 40-41
    if (line.length < 40) {
        return 'UNKNOWN';
    }
    const typeChar = line[39].trim().toUpperCase();
    switch (typeChar) {
        case 'A': return 'CHAR';
        case 'P': return 'PACKED';
        case 'S': return 'ZONED';
        case 'B': return 'BINARY';
        case 'I': return 'INT';
        case 'U': return 'UNS';
        case 'F': return 'FLOAT';
        case 'D': return 'DATE';
        case 'T': return 'TIME';
        case 'Z': return 'TIMESTAMP';
        case 'N': return 'IND';
        default: return typeChar || 'UNKNOWN';
    }
}
function normalizeUsage(raw) {
    switch (raw.trim().toUpperCase()) {
        case 'I': return 'I';
        case 'O': return 'O';
        case 'U': return 'U';
        case 'C': return 'C';
        case 'IP': return 'I';
        case 'UC': return 'U';
        default: return 'UNKNOWN';
    }
}
function resolveDclFUsage(usageStr) {
    const hasInput = usageStr.includes('INPUT');
    const hasOutput = usageStr.includes('OUTPUT');
    const hasUpdate = usageStr.includes('UPDATE');
    if (hasUpdate || (hasInput && hasOutput)) {
        return 'U';
    }
    if (hasInput) {
        return 'I';
    }
    if (hasOutput) {
        return 'O';
    }
    return 'UNKNOWN';
}
function isFixedFspecKeyed(restLine) {
    // Avoid false positives from words like DISK where the letter K appears naturally.
    return /\bKEYED\b/i.test(restLine) || /(?:^|\s)K(?:\s|$)/i.test(restLine);
}
function finalizeOpenBlocks(program, state, lines) {
    if (state.inProcedure && state.currentProc) {
        program.warnings.push({
            message: `Unclosed procedure ${state.currentProc.name}; closed at end of file.`,
            location: state.currentProc.startLocation,
        });
        program.procedures.push(state.currentProc);
        state.currentProc = null;
        state.inProcedure = false;
    }
    if (state.inDS && state.currentDS) {
        program.warnings.push({
            message: `Unclosed data structure ${state.currentDS.name}; closed at end of file.`,
            location: state.currentDS.startLocation,
        });
        program.dataStructures.push(state.currentDS);
        state.currentDS = null;
        state.inDS = false;
    }
    if (state.inPrototype && state.currentPR) {
        program.warnings.push({
            message: `Unclosed prototype ${state.currentPR.name}; closed at end of file.`,
            location: state.currentPR.location,
        });
        program.prototypes.push(state.currentPR);
        state.currentPR = null;
        state.inPrototype = false;
    }
    if (state.inProcInterface && state.currentProc) {
        program.warnings.push({
            message: `Unclosed DCL-PI for procedure ${state.currentProc.name}; interface treated as closed at end of file.`,
            location: state.currentProc.startLocation,
        });
        state.inProcInterface = false;
    }
    if (state.inSqlBlock) {
        program.warnings.push({
            message: 'SQL parser state remained open at end of file.',
            location: { line: state.sqlStartLine, rawLine: lines[state.sqlStartLine] ?? '' },
        });
        state.inSqlBlock = false;
        state.sqlBuffer = '';
    }
}
function classifySqlType(sqlText) {
    const upper = sqlText.trim().toUpperCase();
    for (const [key, re] of Object.entries(R.RE_SQL_TYPE)) {
        if (re.test(upper)) {
            return key;
        }
    }
    return 'OTHER';
}
function flushSql(program, state) {
    const sqlText = state.sqlBuffer.replace(/\s+/g, ' ').trim();
    const stmtType = classifySqlType(sqlText);
    const loc = { line: state.sqlStartLine, rawLine: 'EXEC SQL ...' };
    // Extract cursors from DECLARE statements
    if (stmtType === 'DECLARE') {
        const cursorM = R.RE_DECLARE_CURSOR.exec(sqlText);
        if (cursorM) {
            // Extract the SELECT part (after FOR keyword)
            const forM = /\bFOR\b(.*)/is.exec(sqlText);
            program.cursors.push({
                name: cursorM[1],
                selectText: forM ? forM[1].trim().replace(/;$/, '') : '',
                location: loc,
            });
        }
    }
    program.sqlStatements.push({
        statementType: stmtType,
        text: sqlText.replace(/;$/, ''),
        location: loc,
    });
    state.inSqlBlock = false;
    state.sqlBuffer = '';
}
//# sourceMappingURL=rpgleParser.js.map