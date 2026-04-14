/**
 * regexRules.ts
 * Centralized regex patterns for RPGLE static analysis.
 *
 * RPGLE has two very different syntaxes:
 *   - Fixed-format (legacy): columns 1-5 sequence, 6 = continuation, 6 = spec type
 *   - Free-format (modern):  starts with **FREE or /FREE, uses DCL- keywords
 *
 * Each pattern below includes a comment explaining what it matches and why.
 */

// ─── Source Format Detection ──────────────────────────────────────────────────

/**
 * Detects the compiler directive that switches a member to full free-format.
 * Must appear at column 1 with no leading spaces.
 */
export const RE_FREE_FORMAT_DIRECTIVE = /^\*\*FREE\s*$/i;

/**
 * Legacy /FREE ... /END-FREE inline free-format block.
 */
export const RE_INLINE_FREE_START = /^\s*\/FREE\s*$/i;
export const RE_INLINE_FREE_END   = /^\s*\/END-FREE\s*$/i;

// ─── Comment Detection ────────────────────────────────────────────────────────

/**
 * Fixed-format comment: col 7 is '*' (after 6-char prefix area).
 * We check if the 7th char (index 6) is '*'.
 * Also handle lines that are pure whitespace.
 */
export const RE_FIXED_COMMENT    = /^.{5}[*C]/;   // col 6 = * is a comment indicator
export const RE_FIXED_FULL_COMMENT = /^[\s\d*]{0,5}\*/; // sequence + * in col 7

/**
 * Free-format comment: // anywhere a statement starts.
 */
export const RE_FREE_COMMENT = /^\s*\/\//;

/**
 * Compiler directives (not code, skip for analysis).
 */
export const RE_DIRECTIVE = /^\s*\/(?:COPY|INCLUDE|IF|ELSE|ELSEIF|ENDIF|EOF|DEFINE|UNDEFINE|SPACE|EJECT|TITLE|SET|RESTORE|OVERLOAD|PROTOTYPE)\b/i;

// ─── Copybook / Include ───────────────────────────────────────────────────────

/**
 * /COPY  LIB/FILE,MEMBER   or  /COPY QRPGLESRC,MYMEMBER
 * /INCLUDE has the same syntax.
 * Groups: [1]=library (optional), [2]=member OR just [1]=member
 */
export const RE_COPY_SLASH = /^\s*\/(?:COPY|INCLUDE)\s+(?:(\w+)[\/,])?(\w+)/i;

/**
 * Free-format: /COPY 'path/file.rpgle'   (IFS-style)
 */
export const RE_COPY_IFS = /^\s*\/(?:COPY|INCLUDE)\s+'([^']+)'/i;

// ─── F-Specification (File Declarations) ─────────────────────────────────────

/**
 * Fixed-format F-spec starts with 'F' in column 6 (0-indexed col 5).
 * Columns (0-indexed):
 *   0-4  = sequence
 *   5    = spec type (F)
 *   6-15 = filename (10 chars)
 *   16   = usage: I/O/U/C
 *   17   = file designation: F/S/R/T/P
 *   18   = end-of-file: E
 *   19   = sequence: A/D
 *   20   = file format: F/E/V/T
 *   22-25 = record length
 *   34   = device: DISK/WORKSTN/PRINTER/SEQ/SPECIAL
 */
export const RE_FSPEC_FIXED = /^[\d ]{0,5}F(\S{1,10})\s+(I|O|U|C|IP|UC)\s*(F|S|R|T|P)?\s*(E)?\s*(A|D)?\s*(F|E|V|T)?\s*(\d{1,5})?\s+.{0,14}(DISK|WORKSTN|PRINTER|SEQ|SPECIAL)/i;

/**
 * Simplified fixed F-spec — tolerant version that just grabs name + usage
 * when the full columnar parse isn't clean.
 */
export const RE_FSPEC_FIXED_SIMPLE = /^[\d ]{0,5}F(\w{1,10})\s+(I|O|U|C|IP|UC)/i;

/**
 * Free-format DCL-F declaration.
 * DCL-F filename Usage(*INPUT : *OUTPUT : *UPDATE : *DELETE) ...
 */
export const RE_DCL_F = /^\s*DCL-F\s+(\w+)\s+(?:Usage\s*\(\s*([^)]+)\s*\))?/i;

/**
 * Detect WORKSTN / PRINTER in DCL-F line for file type classification.
 */
export const RE_DCL_F_DEVICE = /\b(WORKSTN|PRINTER|DISK|SEQ|SPECIAL)\b/i;
export const RE_DCL_F_KEYED  = /\bKeyed\b/i;

// ─── Program Calls ────────────────────────────────────────────────────────────

/**
 * Fixed-format CALL: op-code CALL in cols 26-35, operand in 36-49.
 * We just look for CALL (and variants) with a following quoted or bare name.
 */
export const RE_CALL_FIXED = /^\s*(?:C\s+)?(?:\w+\s+)?CALL\s+['"]?(\w+)['"]?/i;

/**
 * Free-format CALL 'PGMNAME' or CALL pgmName
 */
export const RE_CALL_FREE = /^\s*CALL\s+['"]?(\w+)['"]?/i;

/**
 * CALLP for procedure calls (free + fixed).
 */
export const RE_CALLP = /^\s*CALLP?\s+(\w+)\s*[;(]/i;

/**
 * CALLB (bound call) — legacy.
 */
export const RE_CALLB = /^\s*CALLB\s+['"]?(\w+)['"]?/i;

// ─── Procedure Declarations ───────────────────────────────────────────────────

/**
 * Free-format procedure start.
 * DCL-PROC procName [Export];
 */
export const RE_DCL_PROC = /^\s*DCL-PROC\s+(\w+)(?:\s+(Export))?/i;

/**
 * Free-format procedure interface (return type line).
 * DCL-PI procName [returnType];
 */
export const RE_DCL_PI = /^\s*DCL-PI\s+(\w+)(?:\s+(\w[\w()]*))?\s*;/i;

/**
 * End of procedure.
 */
export const RE_END_PROC = /^\s*END-PROC(?:\s+\w+)?\s*;?/i;
export const RE_END_PI   = /^\s*END-PI\s*;?/i;

/**
 * Fixed-format procedure: P in col 6.
 * P  procname       B   (begin)
 * P  procname       E   (end)
 */
export const RE_PSPEC_BEGIN = /^[\d ]{0,5}P(\w{1,15})\s+B/i;
export const RE_PSPEC_END   = /^[\d ]{0,5}P(\w{1,15})\s+E/i;

// ─── Data Structures ─────────────────────────────────────────────────────────

/**
 * Free-format data structure declaration.
 * DCL-DS name [Qualified] [LikeDS(base)] [Template] [End-DS];
 */
export const RE_DCL_DS = /^\s*DCL-DS\s+(\w+)(?:\s+(Qualified|LikeDS\s*\(\s*\w+\s*\)|Template|Dim\s*\(\s*\d+\s*\)))?/i;
export const RE_DCL_DS_LIKEDS = /LikeDS\s*\(\s*(\w+)\s*\)/i;
export const RE_DCL_DS_QUALIFIED = /\bQualified\b/i;
export const RE_DCL_DS_TEMPLATE  = /\bTemplate\b/i;
export const RE_END_DS = /^\s*END-DS(?:\s+\w+)?\s*;?/i;

/**
 * Fixed D-spec data structure:
 * D  dsname     DS
 */
export const RE_DSPEC_DS    = /^[\d ]{0,5}D(\w{1,15})\s+DS/i;
export const RE_DSPEC_ARRAY = /^[\d ]{0,5}D(\w{1,15})\s+S.*\bDIM\s*\(/i;
export const RE_DSPEC_SUBFIELD = /^[\d ]{0,5}D\s+(\w{1,15})\s+/i;

// ─── Variables ────────────────────────────────────────────────────────────────

/**
 * Free-format standalone variable.
 * DCL-S name type [Len(n)] [Inz(val)];
 */
export const RE_DCL_S = /^\s*DCL-S\s+(\w+)\s+(\w[\w()*]*(?:\s*\(\s*[\w:,\s*]+\s*\))?)/i;

/**
 * Constant.
 * DCL-C name value;
 */
export const RE_DCL_C = /^\s*DCL-C\s+(\w+)\s+(.*?)\s*;/i;

/**
 * Fixed D-spec standalone variable (S in col 24).
 */
export const RE_DSPEC_S = /^[\d ]{0,5}D(\w{1,15})\s+S\s+/i;
export const RE_DSPEC_C = /^[\d ]{0,5}D(\w{1,15})\s+C\s+/i;

// ─── Prototype Declarations ───────────────────────────────────────────────────

/**
 * DCL-PR name [ExtPgm('pgmname')] [ExtProc('procname')];
 */
export const RE_DCL_PR      = /^\s*DCL-PR\s+(\w+)/i;
export const RE_EXTPGM      = /ExtPgm\s*\(\s*['"]?(\w+)['"]?\s*\)/i;
export const RE_EXTPROC     = /ExtProc\s*\(\s*['"]?(\w+)['"]?\s*\)/i;
export const RE_END_PR      = /^\s*END-PR(?:\s+\w+)?\s*;?/i;

// ─── SQL Statements ───────────────────────────────────────────────────────────

/**
 * EXEC SQL block start — everything after is SQL until the semicolon.
 * Can be on a single line or span multiple lines.
 */
export const RE_EXEC_SQL = /^\s*EXEC\s+SQL\s+(.*)/i;

/**
 * SQL DECLARE CURSOR.
 * DECLARE cursorname CURSOR [WITH HOLD] FOR ...
 */
export const RE_DECLARE_CURSOR = /DECLARE\s+(\w+)\s+CURSOR/i;

/**
 * Other SQL keywords for statement type classification.
 */
export const RE_SQL_TYPE: Record<string, RegExp> = {
  SELECT : /^\s*SELECT\b/i,
  INSERT : /^\s*INSERT\b/i,
  UPDATE : /^\s*UPDATE\b/i,
  DELETE : /^\s*DELETE\b/i,
  DECLARE: /^\s*DECLARE\b/i,
  OPEN   : /^\s*OPEN\b/i,
  FETCH  : /^\s*FETCH\b/i,
  CLOSE  : /^\s*CLOSE\b/i,
  SET    : /^\s*SET\b/i,
  CREATE : /^\s*CREATE\b/i,
  DROP   : /^\s*DROP\b/i,
};

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** Detects continuation character in fixed-format (col 85+, + sign) */
export const RE_FIXED_CONTINUATION = /\+\s*$/;

/** Detect CTL-OPT in free format */
export const RE_CTL_OPT = /^\s*CTL-OPT\b/i;

/** Detect H-spec (control spec in fixed format) */
export const RE_HSPEC = /^[\d ]{0,5}H\b/i;
