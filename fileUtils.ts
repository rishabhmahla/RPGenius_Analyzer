/**
 * fileUtils.ts
 * Utilities for file I/O, workspace scanning, and editor decoration.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ─── RPGLE File Extensions ────────────────────────────────────────────────────

/** Extensions commonly used for RPGLE source files */
export const RPGLE_EXTENSIONS = new Set([
  '.rpgle', '.rpg', '.sqlrpgle', '.sqlrpg',
  '.clle', '.cl38', '.clp',
  '.pf', '.pfdds', '.dspf', '.dds',
  '.pgm', '.srvpgm',
  '.rpgleinc', '.rpglesrc', '.mbr', '.RPGLE', '.RPG',
]);

// ─── File Reading ─────────────────────────────────────────────────────────────

/**
 * Reads a file synchronously, returning its content as a string.
 * Returns null if the file cannot be read.
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, { encoding: 'utf8' });
  } catch {
    return null;
  }
}

/**
 * Reads the content of the currently active editor's document.
 */
export function getActiveEditorContent(): { content: string; filePath: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return null; }
  return {
    content: editor.document.getText(),
    filePath: editor.document.uri.toString(true),
  };
}

// ─── RPGLE File Detection ─────────────────────────────────────────────────────

/**
 * Returns true if the file path looks like an RPGLE source file.
 * Checks extension AND content heuristics.
 */
export function isRpgleFile(filePath: string, content?: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (RPGLE_EXTENSIONS.has(ext)) { return true; }

  // Heuristic: check content for RPGLE markers
  if (content) {
    const firstLines = content.split('\n').slice(0, 20).join('\n').toUpperCase();
    return (
      firstLines.includes('**FREE') ||
      firstLines.includes('DCL-F') ||
      firstLines.includes('DCL-S') ||
      firstLines.includes('DCL-PROC') ||
      firstLines.includes('EXEC SQL') ||
      /^[\d ]{0,5}[HFDICOP]\s/m.test(firstLines)  // Fixed spec
    );
  }

  return false;
}

export function isAnalyzableSource(filePath: string, content?: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (RPGLE_EXTENSIONS.has(ext)) { return true; }

  if (content) {
    const firstLines = content.split('\n').slice(0, 40).join('\n').toUpperCase();
    return (
      isRpgleFile(filePath, content) ||
      firstLines.includes('EXEC SQL') ||
      firstLines.includes('PGM') ||
      firstLines.includes('DCL VAR(') ||
      firstLines.includes('OVRDBF') ||
      /^.{5}A/m.test(content)
    );
  }

  return false;
}

// ─── Workspace Scanning ───────────────────────────────────────────────────────

/**
 * Recursively finds all RPGLE files in the given workspace folder.
 * Respects the workspace's exclude settings.
 */
export async function findRpgleFiles(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<vscode.Uri[]> {
  const pattern = new vscode.RelativePattern(
    workspaceFolder,
    '**/*.{rpgle,rpg,sqlrpgle,sqlrpg,clle,cl38,clp,pf,pfdds,dspf,dds,RPGLE,RPG,rpgleinc}'
  );
  const excludes = getExcludePattern();
  return vscode.workspace.findFiles(pattern, excludes, 500);
}

function getExcludePattern(): string {
  return '{**/node_modules/**,**/out/**,**/.git/**,**/bin/**}';
}

// ─── Editor Decoration ───────────────────────────────────────────────────────

/** Decoration type for highlighting analyzed elements */
let highlightDecoration: vscode.TextEditorDecorationType | undefined;

/**
 * Creates (or reuses) a highlight decoration type.
 */
function getHighlightDecoration(): vscode.TextEditorDecorationType {
  if (!highlightDecoration) {
    highlightDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }
  return highlightDecoration;
}

/**
 * Highlights a set of line numbers in the active editor.
 * @param lineNumbers - 0-based line numbers to highlight
 */
export function highlightLines(editor: vscode.TextEditor, lineNumbers: number[]): void {
  const decoration = getHighlightDecoration();
  const ranges = lineNumbers
    .filter(n => n >= 0 && n < editor.document.lineCount)
    .map(n => {
      const line = editor.document.lineAt(n);
      return new vscode.Range(n, 0, n, line.text.length);
    });
  editor.setDecorations(decoration, ranges);
}

/**
 * Clears all RPGenius highlights from the editor.
 */
export function clearHighlights(editor: vscode.TextEditor): void {
  if (highlightDecoration) {
    editor.setDecorations(highlightDecoration, []);
  }
}

/**
 * Disposes the decoration type (called on extension deactivate).
 */
export function disposeDecorations(): void {
  if (highlightDecoration) {
    highlightDecoration.dispose();
    highlightDecoration = undefined;
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Opens a file in the editor and scrolls to a specific line.
 * @param filePath   - Absolute path to the file
 * @param lineNumber - 0-based line number
 */
export async function navigateToLine(filePath: string, lineNumber: number): Promise<void> {
  try {
    const uri = toDocumentUri(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });

    // Clamp line number to valid range
    const safeLine = Math.max(0, Math.min(lineNumber, doc.lineCount - 1));
    const pos = new vscode.Position(safeLine, 0);
    const range = new vscode.Range(pos, pos);

    // Scroll to line and place cursor
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Briefly highlight the target line
    highlightLines(editor, [safeLine]);
    setTimeout(() => clearHighlights(editor), 2500);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`RPGenius: Cannot navigate to file — ${msg}`);
  }
}

function toDocumentUri(resource: string): vscode.Uri {
  if (/^[a-z][a-z0-9+.-]*:/i.test(resource)) {
    return vscode.Uri.parse(resource);
  }
  return vscode.Uri.file(resource);
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Creates (or reuses) the RPGenius status bar item.
 */
export function getStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.command = 'rpgenius.analyzeFile';
  }
  return statusBarItem;
}

/**
 * Updates the status bar with analysis results.
 */
export function updateStatusBar(
  programName: string,
  counts: { files: number; calls: number; procs: number; sql: number }
): void {
  const bar = getStatusBarItem();
  bar.text = `$(file-code) ${programName}: ${counts.files}F ${counts.calls}C ${counts.procs}P ${counts.sql}SQL`;
  bar.tooltip = [
    `RPGenius: ${programName}`,
    `Files: ${counts.files}`,
    `Calls: ${counts.calls}`,
    `Procedures: ${counts.procs}`,
    `SQL Statements: ${counts.sql}`,
    `Click to re-analyze`,
  ].join('\n');
  bar.show();
}

/**
 * Shows a "Analyzing..." state in the status bar.
 */
export function showAnalyzingStatus(): void {
  const bar = getStatusBarItem();
  bar.text = '$(sync~spin) RPGenius: Analyzing...';
  bar.tooltip = 'RPGenius is parsing your RPGLE file...';
  bar.show();
}

/**
 * Hides and disposes the status bar item.
 */
export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}
