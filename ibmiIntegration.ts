import * as vscode from 'vscode';
import { FieldValidationIssue, FileRef, ResolvedObjectRef, RpgleProgram } from './models';

const IBMI_EXTENSION_IDS = [
  'halcyontechltd.code-for-ibmi',
  'IBM.vscode-ibmi',
];

interface IbmiRuntime {
  extensionId: string;
  api: any;
}

interface IbmiSourceContext {
  library?: string;
  sourceFile?: string;
  member?: string;
}

export function isLikelyIbmiDocument(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file') {
    return true;
  }
  const upper = `${doc.uri.path} ${doc.fileName}`.toUpperCase();
  return upper.includes('.LIB/') || upper.includes('/QSYS.LIB/');
}

export function inferIbmiSourceContext(uri: vscode.Uri): IbmiSourceContext {
  const text = `${uri.toString(true)} ${uri.path}`;
  const m = /\/([^\/]+)\.LIB\/([^\/]+)\.FILE\/([^\/]+)\.MBR/i.exec(text);
  if (!m) {
    return {};
  }

  return {
    library: m[1].toUpperCase(),
    sourceFile: m[2].toUpperCase(),
    member: m[3].toUpperCase(),
  };
}

export async function enrichProgramWithIbmiMetadata(
  program: RpgleProgram,
  docUri: vscode.Uri,
  content: string
): Promise<void> {
  const runtime = await getIbmiRuntime();
  if (!runtime) {
    if (isLikelyUriForIbmi(docUri)) {
      program.warnings.push({
        message: 'IBM i integration unavailable. Install/connect Code for IBM i extension for library and field resolution.',
        location: { line: 0, rawLine: '' },
      });
    }
    return;
  }

  const context = inferIbmiSourceContext(docUri);

  for (const fileRef of program.files) {
    const resolved = await resolveFile(runtime, fileRef, context);
    if (resolved) {
      fileRef.resolvedObject = resolved;
    }
  }

  for (const call of program.programCalls) {
    const resolved = await resolveProgramCall(runtime, call.programName, context);
    if (resolved) {
      call.resolvedObject = resolved;
    }
  }

  program.fieldValidationIssues = validateFieldReferences(program, content);
}

export async function openIbmiObjectSource(ref: ResolvedObjectRef): Promise<boolean> {
  const attempts: Array<{ command: string; args: any[] }> = [
    {
      command: 'code-for-ibmi.openEditable',
      args: [{ library: ref.library, object: ref.objectName, objectType: ref.objectType }],
    },
    {
      command: 'code-for-ibmi.openWithDefaultMode',
      args: [{ library: ref.library, object: ref.objectName, objectType: ref.objectType }],
    },
    {
      command: 'code-for-ibmi.openMember',
      args: [{ library: ref.library, sourceFile: 'QRPGLESRC', member: ref.objectName }],
    },
  ];

  for (const attempt of attempts) {
    try {
      await vscode.commands.executeCommand(attempt.command, ...attempt.args);
      return true;
    } catch {
      // Try next command shape.
    }
  }

  return false;
}

export async function tryOpenAndAnalyzeIbmiMember(analyzeCurrent: (silent?: boolean) => Promise<void>): Promise<void> {
  const pickerCommands = [
    'code-for-ibmi.openEditable',
    'code-for-ibmi.openWithDefaultMode',
    'code-for-ibmi.browseIFS',
  ];

  let opened = false;
  for (const cmd of pickerCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      opened = true;
      break;
    } catch {
      // Keep trying until a supported command is found.
    }
  }

  if (!opened) {
    vscode.window.showWarningMessage(
      'RPGenius: Could not invoke IBM i member picker automatically. Open a member from Code for IBM i and run Analyze RPG Program.'
    );
    return;
  }

  await analyzeCurrent(false);
}

async function getIbmiRuntime(): Promise<IbmiRuntime | null> {
  for (const id of IBMI_EXTENSION_IDS) {
    const ext = vscode.extensions.getExtension(id);
    if (!ext) {
      continue;
    }

    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      return { extensionId: id, api: ext.exports };
    } catch {
      // Try next extension id.
    }
  }

  return null;
}

function isLikelyUriForIbmi(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') {
    return true;
  }
  const up = uri.toString(true).toUpperCase();
  return up.includes('.LIB/') || up.includes('/QSYS.LIB/');
}

async function resolveFile(runtime: IbmiRuntime, fileRef: FileRef, context: IbmiSourceContext): Promise<ResolvedObjectRef | null> {
  const found = await resolveBySql(runtime, fileRef.name, ['*FILE'], context.library);
  if (!found) {
    return null;
  }

  const fields = await resolveFileFields(runtime, found.library, found.objectName);
  return {
    ...found,
    objectType: 'FILE',
    fields,
  };
}

async function resolveProgramCall(runtime: IbmiRuntime, programName: string, context: IbmiSourceContext): Promise<ResolvedObjectRef | null> {
  const found = await resolveBySql(runtime, programName, ['*PGM', '*SRVPGM'], context.library);
  if (!found) {
    return null;
  }

  return {
    ...found,
    objectType: found.objectType === 'SRVPGM' ? 'SRVPGM' : 'PGM',
  };
}

async function resolveBySql(
  runtime: IbmiRuntime,
  objectName: string,
  objectTypes: string[],
  preferredLibrary?: string
): Promise<ResolvedObjectRef | null> {
  const safeName = sqlLiteral(objectName.toUpperCase());
  const typeList = objectTypes.map(sqlLiteral).join(', ');

  const sql = [
    'SELECT OBJLIB AS LIBRARY, OBJNAME AS OBJECT_NAME,',
    "CASE WHEN OBJTYPE = '*SRVPGM' THEN 'SRVPGM'",
    "     WHEN OBJTYPE = '*FILE' THEN 'FILE'",
    "     WHEN OBJTYPE = '*PGM' THEN 'PGM'",
    "     ELSE 'UNKNOWN' END AS OBJECT_TYPE",
    "FROM TABLE(QSYS2.OBJECT_STATISTICS('*ALLUSR', '*ALL'))",
    `WHERE OBJNAME = ${safeName}`,
    `  AND OBJTYPE IN (${typeList})`,
    preferredLibrary ? `ORDER BY CASE WHEN OBJLIB = ${sqlLiteral(preferredLibrary.toUpperCase())} THEN 0 ELSE 1 END` : '',
    'FETCH FIRST 1 ROW ONLY',
  ].filter(Boolean).join(' ');

  const rows = await runSql(runtime, sql);
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    objectName: String(row.OBJECT_NAME ?? row.object_name ?? objectName).toUpperCase(),
    library: String(row.LIBRARY ?? row.library ?? '').toUpperCase(),
    objectType: normalizeObjectType(String(row.OBJECT_TYPE ?? row.object_type ?? 'UNKNOWN')),
  };
}

async function resolveFileFields(runtime: IbmiRuntime, library: string, file: string): Promise<string[]> {
  const sql = [
    'SELECT SYSTEM_COLUMN_NAME',
    'FROM QSYS2.SYSCOLUMNS',
    `WHERE SYSTEM_TABLE_SCHEMA = ${sqlLiteral(library.toUpperCase())}`,
    `  AND SYSTEM_TABLE_NAME = ${sqlLiteral(file.toUpperCase())}`,
    'ORDER BY ORDINAL_POSITION',
  ].join(' ');

  const rows = await runSql(runtime, sql);
  const fields = rows
    .map((row) => String(row.SYSTEM_COLUMN_NAME ?? row.system_column_name ?? '').toUpperCase())
    .filter(Boolean);

  return Array.from(new Set(fields));
}

async function runSql(runtime: IbmiRuntime, sql: string): Promise<any[]> {
  const api = runtime.api;
  const candidates: Array<() => Thenable<any> | Promise<any>> = [];

  if (api?.runSQL && typeof api.runSQL === 'function') {
    candidates.push(() => api.runSQL(sql));
  }

  if (api?.connection?.runSQL && typeof api.connection.runSQL === 'function') {
    candidates.push(() => api.connection.runSQL(sql));
  }

  candidates.push(() => vscode.commands.executeCommand('code-for-ibmi.runSQL', sql));
  candidates.push(() => vscode.commands.executeCommand('code-for-ibmi.runSQL', { sql }));

  for (const call of candidates) {
    try {
      const result = await call();
      const rows = normalizeRows(result);
      if (rows.length >= 0) {
        return rows;
      }
    } catch {
      // Try the next candidate shape.
    }
  }

  return [];
}

function normalizeRows(result: any): any[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.rows)) {
    return result.rows;
  }

  if (Array.isArray(result.result)) {
    return result.result;
  }

  if (Array.isArray(result.data)) {
    return result.data;
  }

  return [];
}

function normalizeObjectType(raw: string): ResolvedObjectRef['objectType'] {
  const type = raw.toUpperCase().replace('*', '');
  switch (type) {
    case 'FILE':
      return 'FILE';
    case 'PGM':
      return 'PGM';
    case 'SRVPGM':
      return 'SRVPGM';
    case 'MODULE':
      return 'MODULE';
    default:
      return 'UNKNOWN';
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function validateFieldReferences(program: RpgleProgram, content: string): FieldValidationIssue[] {
  const fileFieldMap = new Map<string, Set<string>>();
  for (const file of program.files) {
    const fields = file.resolvedObject?.fields;
    if (fields && fields.length > 0) {
      fileFieldMap.set(file.name.toUpperCase(), new Set(fields.map(f => f.toUpperCase())));
    }
  }

  if (fileFieldMap.size === 0) {
    return [];
  }

  const issues: FieldValidationIssue[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const regex = /\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      const fileName = match[1].toUpperCase();
      const fieldName = match[2].toUpperCase();
      const fields = fileFieldMap.get(fileName);
      if (!fields) {
        continue;
      }

      if (!fields.has(fieldName)) {
        const key = `${i}:${fileName}:${fieldName}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        issues.push({
          fileName,
          fieldName,
          message: `Field ${fileName}.${fieldName} not found in resolved file metadata.`,
          location: { line: i, rawLine: line },
        });
      }
    }
  }

  return issues;
}
