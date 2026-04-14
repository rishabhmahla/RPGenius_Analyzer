/**
 * models.ts
 * Core data model interfaces for the RPGenius Analyzer.
 * Every parsed element from RPGLE source is typed here.
 */

// ─── Source Location ──────────────────────────────────────────────────────────

/**
 * Tracks where in the source file an element was found.
 * Used to enable "click to navigate" in the tree view.
 */
export interface SourceLocation {
  /** 0-based line number in the source file */
  line: number;
  /** The raw source text of the line */
  rawLine: string;
}

// ─── Individual Element Types ─────────────────────────────────────────────────

export interface CopybookRef {
  /** Library portion of /COPY LIB,MBR */
  library: string;
  /** Member name portion */
  member: string;
  location: SourceLocation;
}

export type FileUsage = 'I' | 'O' | 'U' | 'C' | 'UNKNOWN';
export type FileType  = 'DISK' | 'WORKSTN' | 'PRINTER' | 'SEQ' | 'SPECIAL' | 'UNKNOWN';

export interface FileRef {
  name: string;
  usage: FileUsage;
  fileType: FileType;
  /** Record length if determinable from F-spec position 24-27 */
  recordLength?: number;
  /** EXTDESC or keyed designation if present */
  keyed: boolean;
  isDisplayFile: boolean;
  isPrinterFile: boolean;
  resolvedObject?: ResolvedObjectRef;
  location: SourceLocation;
}

export interface ProgramCall {
  /** The called program name (may include quotes) */
  programName: string;
  /** 'CALL' = legacy fixed-style, 'CALLP' = procedure call, 'CALLB' = bound call */
  callType: 'CALL' | 'CALLP' | 'CALLB';
  resolvedObject?: ResolvedObjectRef;
  location: SourceLocation;
}

export interface ResolvedObjectRef {
  objectName: string;
  library: string;
  objectType: 'FILE' | 'PGM' | 'SRVPGM' | 'MODULE' | 'UNKNOWN';
  sourceUri?: string;
  fields?: string[];
}

export interface ProcedureRef {
  name: string;
  /** Procedure interface parameters extracted from DCL-PI */
  parameters: ProcParameter[];
  returnType?: string;
  isExported: boolean;
  startLocation: SourceLocation;
  endLocation?: SourceLocation;
}

export interface ProcParameter {
  name: string;
  type: string;
  direction: 'VALUE' | 'REF' | 'CONST' | 'UNKNOWN';
}

export interface DataStructureRef {
  name: string;
  /** DS, array, data structure template, etc. */
  dsType: 'DS' | 'ARRAY' | 'LIKEDS' | 'QUALIFIED' | 'TEMPLATE';
  /** LIKEDS(base) if applicable */
  likeBase?: string;
  qualified: boolean;
  /** Subfields found inside the DS */
  subfields: SubfieldRef[];
  startLocation: SourceLocation;
  endLocation?: SourceLocation;
}

export interface SubfieldRef {
  name: string;
  type: string;
  location: SourceLocation;
  /** For PF fields: DDS attributes (COLHDG, COLTXT, EDTCDE, etc.) */
  attributes?: Record<string, string>;
  /** For PF fields: column heading */
  columnHeading?: string;
  /** For PF fields: length in DDS */
  length?: number;
  /** For PF fields: decimal positions (if numeric) */
  decimals?: number;
}

export interface DdsKeyRef {
  name: string;
  keyFields: string[];
  /** PRIMARY, UNIQUE, DUPLICATE, etc. */
  keyType: string;
  location: SourceLocation;
}

export interface SqlStatement {
  /** First keyword after EXEC SQL */
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DECLARE' | 'OPEN' | 'FETCH' | 'CLOSE' | 'SET' | 'CREATE' | 'DROP' | 'OTHER';
  /** Condensed/trimmed full SQL text */
  text: string;
  location: SourceLocation;
}

export interface CursorRef {
  name: string;
  /** The SELECT statement associated with this cursor */
  selectText: string;
  location: SourceLocation;
}

export interface VariableRef {
  name: string;
  /** DCL-S type — CHAR, INT, PACKED, etc. */
  varType: string;
  length?: string;
  /** INZ value if present */
  initialValue?: string;
  isConstant: boolean;
  location: SourceLocation;
}

export interface PrototypeRef {
  name: string;
  /** External program name if ExtPgm() is specified */
  externalName?: string;
  parameters: ProcParameter[];
  returnType?: string;
  location: SourceLocation;
}

// ─── Top-Level Program Model ──────────────────────────────────────────────────

/**
 * The full parsed representation of one RPGLE source member.
 */
export interface RpgleProgram {
  /** Filename or member name */
  programName: string;
  /** Absolute path to the file on disk */
  filePath: string;
  /** Logical source kind handled by analyzer dispatcher */
  sourceType?: 'RPGLE' | 'SQLRPGLE' | 'CLLE' | 'CL38' | 'PF_DDS' | 'DSPF_DDS' | 'UNKNOWN';
  /** Free-format, fixed-format, or mixed */
  sourceFormat: 'FREE' | 'FIXED' | 'MIXED';
  /** Total lines in the source */
  totalLines: number;

  copybooks: CopybookRef[];
  files: FileRef[];
  programCalls: ProgramCall[];
  procedures: ProcedureRef[];
  dataStructures: DataStructureRef[];
  /** DDS keys (for PF/DSPF sources) */
  ddsKeys: DdsKeyRef[];
  sqlStatements: SqlStatement[];
  cursors: CursorRef[];
  variables: VariableRef[];
  prototypes: PrototypeRef[];

  /** Parsing warnings (e.g., ambiguous lines) */
  warnings: ParseWarning[];
  /** Semantic issues found after parse (for example, unresolved fields). */
  fieldValidationIssues: FieldValidationIssue[];
  /** Timestamp of last parse */
  parsedAt: Date;
}

export interface ParseWarning {
  message: string;
  location: SourceLocation;
}

export interface FieldValidationIssue {
  fileName: string;
  fieldName: string;
  message: string;
  location: SourceLocation;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────

export interface DependencyNode {
  programName: string;
  filePath: string;
  /** Programs this program calls */
  calls: string[];
  /** Files this program uses */
  usesFiles: string[];
  /** Copybooks included */
  includesCopybooks: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  /** Returns all programs that call a given program */
  calledBy: Map<string, string[]>;
}
