/**
 * extension.ts
 * RPGenius Analyzer — VS Code Extension Entry Point
 *
 * Registers:
 *   - rpgenius.analyzeFile       → parses current editor file
 *   - rpgenius.analyzeWorkspace  → parses all RPGLE files in workspace
 *   - rpgenius.navigateToLine    → internal command for tree item click
 *   - rpgenius.refresh           → refresh tree without re-parsing
 *   - rpgenius.clearResults      → clear the tree view
 *
 * Wires together: parser → dependency builder → tree provider
 */

import * as vscode from 'vscode';
import { buildDependencyGraph, buildDependencyGraphFromMany } from './dependencyBuilder';
import { RpgeniusTreeProvider } from './treeProvider';
import { analyzeSource } from './multiSourceAnalyzer';
import {
  getActiveEditorContent,
  isAnalyzableSource,
  navigateToLine,
  showAnalyzingStatus,
  updateStatusBar,
  disposeDecorations,
  disposeStatusBar,
  findRpgleFiles,
  readFileSafe,
} from './fileUtils';
import {
  enrichProgramWithIbmiMetadata,
  openIbmiObjectSource,
  tryOpenAndAnalyzeIbmiMember,
} from './ibmiIntegration';
import { openSourceVisualization } from './sourceVisualizer';

let fieldDiagnostics: vscode.DiagnosticCollection | undefined;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  console.log('RPGenius Analyzer is now active.');
  fieldDiagnostics = vscode.languages.createDiagnosticCollection('rpgeniusFieldValidation');

  // ── Tree View Provider ─────────────────────────────────────────────────────
  const treeProvider = new RpgeniusTreeProvider();

  const treeView = vscode.window.createTreeView('rpgeniusAnalyzer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: false,
  });

  // ── Register Commands ──────────────────────────────────────────────────────

  // 1. Analyze current file
  const analyzeFileCmd = vscode.commands.registerCommand(
    'rpgenius.analyzeFile',
    () => analyzeCurrentFile(treeProvider)
  );

  // 2. Analyze all RPGLE files in workspace
  const analyzeWorkspaceCmd = vscode.commands.registerCommand(
    'rpgenius.analyzeWorkspace',
    () => analyzeWorkspace(treeProvider)
  );

  const visualizeSourceCmd = vscode.commands.registerCommand(
    'rpgenius.visualizeSource',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('RPGenius: Open a source first for visualization.');
        return;
      }
      await openSourceVisualization(editor.document);
    }
  );

  const analyzeIbmiMemberCmd = vscode.commands.registerCommand(
    'rpgenius.analyzeIbmiMember',
    () => tryOpenAndAnalyzeIbmiMember((silent) => analyzeCurrentFile(treeProvider, !!silent))
  );

  // 3. Internal: navigate to line (triggered by tree item click)
  const navigateCmd = vscode.commands.registerCommand(
    'rpgenius.navigateToLine',
    (filePath: string, lineNumber: number) => navigateToLine(filePath, lineNumber)
  );

  // 4. Refresh current view
  const refreshCmd = vscode.commands.registerCommand(
    'rpgenius.refresh',
    () => {
      treeProvider.refresh();
      vscode.window.showInformationMessage('RPGenius: Tree refreshed.');
    }
  );

  // 5. Clear results
  const clearCmd = vscode.commands.registerCommand(
    'rpgenius.clearResults',
    () => {
      treeProvider.clear();
      clearFieldDiagnostics();
      vscode.window.showInformationMessage('RPGenius: Results cleared.');
    }
  );

  const openIbmiSourceCmd = vscode.commands.registerCommand(
    'rpgenius.openIbmiObjectSource',
    async (ref) => {
      if (!ref) {
        vscode.window.showWarningMessage('RPGenius: No IBM i object metadata available to open source.');
        return;
      }

      const opened = await openIbmiObjectSource(ref);
      if (!opened) {
        vscode.window.showWarningMessage(
          `RPGenius: Could not open source for ${ref.library}/${ref.objectName}. Open it from Code for IBM i browser and retry.`
        );
      }
    }
  );

  // ── Auto-analyze on editor switch ─────────────────────────────────────────
  // When the active editor changes, auto-analyze if it's an RPGLE file and
  // we've already analyzed it before (use cache to avoid expensive re-parse).
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (!editor) { return; }
    const filePath = editor.document.uri.toString(true);
    const cached = treeProvider.getCached(filePath);
    if (cached) {
      treeProvider.setProgram(cached, filePath);
      return;
    }
    // Auto-analyze recognized RPGLE files silently on first open
    if (isAnalyzableSource(filePath, editor.document.getText())) {
      analyzeCurrentFile(treeProvider, true /* silent */);
    }
  });

  // ── Auto-analyze on save ───────────────────────────────────────────────────
  const onSave = vscode.workspace.onDidSaveTextDocument(doc => {
    const filePath = doc.uri.toString(true);
    if (isAnalyzableSource(filePath, doc.getText())) {
      // Re-parse after save to keep the tree current
      const content = doc.getText();
      const program = analyzeSource(content, filePath);
      enrichProgramWithIbmiMetadata(program, doc.uri, content)
        .finally(() => {
          treeProvider.setProgram(program, filePath);
          publishFieldDiagnosticsForDocument(doc, program);
        });
      updateStatusBar(program.programName, {
        files: program.files.length,
        calls: program.programCalls.length,
        procs: program.procedures.length,
        sql: program.sqlStatements.length,
      });
    }
  });

  // ── Register all subscriptions ─────────────────────────────────────────────
  context.subscriptions.push(
    treeView,
    analyzeFileCmd,
    analyzeWorkspaceCmd,
    navigateCmd,
    refreshCmd,
    clearCmd,
    analyzeIbmiMemberCmd,
    openIbmiSourceCmd,
    onEditorChange,
    onSave,
    fieldDiagnostics,
    visualizeSourceCmd,
  );

  // ── Analyze current file on activation (if one is open) ───────────────────
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;
    if (isAnalyzableSource(editor.document.fileName, editor.document.getText())) {
      analyzeCurrentFile(treeProvider, true /* silent */);
    }
  }
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
  clearFieldDiagnostics();
  fieldDiagnostics?.dispose();
  fieldDiagnostics = undefined;
  disposeDecorations();
  disposeStatusBar();
  console.log('RPGenius Analyzer deactivated.');
}

// ─── Command Implementations ──────────────────────────────────────────────────

/**
 * Analyzes the currently active editor file.
 * Shows a progress notification, parses, and updates the tree.
 *
 * @param treeProvider - The sidebar tree provider to update
 * @param silent       - If true, don't show success notification (used for auto-analyze)
 */
async function analyzeCurrentFile(
  treeProvider: RpgeniusTreeProvider,
  silent = false
): Promise<void> {
  const active = getActiveEditorContent();
  if (!active) {
    if (!silent) {
      vscode.window.showWarningMessage('RPGenius: No active editor. Please open an RPGLE file.');
    }
    return;
  }

  const { content, filePath } = active;

  if (!isAnalyzableSource(filePath, content)) {
    if (!silent) {
      vscode.window.showWarningMessage(
        `RPGenius: "${filePath.split('/').pop()}" is not recognized as RPGLE/SQLRPGLE/CLLE/CL38/PF/DSPF source.`
      );
    }
    return;
  }

  showAnalyzingStatus();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🔍 RPGenius: Analyzing RPGLE file...',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Parsing source...' });

      try {
        // Parse the source
        const program = analyzeSource(content, filePath);

        // Attempt IBM i metadata enrichment when available.
        const activeEditor = vscode.window.activeTextEditor;
        const sourceUri = activeEditor ? activeEditor.document.uri : vscode.Uri.file(filePath);
        await enrichProgramWithIbmiMetadata(program, sourceUri, content);

        progress.report({ message: 'Building dependency model...' });

        // Build dependency graph (used for future cross-file features)
        const _depGraph = buildDependencyGraph(program);

        progress.report({ message: 'Updating tree view...' });

        // Update sidebar tree
        treeProvider.setProgram(program, filePath);
        const doc = vscode.window.activeTextEditor?.document;
        if (doc && doc.getText() === content) {
          publishFieldDiagnosticsForDocument(doc, program);
        }

        // Update status bar
        updateStatusBar(program.programName, {
          files: program.files.length,
          calls: program.programCalls.length,
          procs: program.procedures.length,
          sql: program.sqlStatements.length,
        });

        // Show warnings if any
        if (program.warnings.length > 0 && !silent) {
          vscode.window.showWarningMessage(
            `RPGenius: Analysis complete with ${program.warnings.length} warning(s). ` +
            program.warnings[0].message
          );
        } else if (!silent) {
          const summary = buildSummaryMessage(program);
          vscode.window.showInformationMessage(`✅ RPGenius: ${summary}`);
        }

        // Show panel
        await vscode.commands.executeCommand('rpgeniusAnalyzer.focus');

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`❌ RPGenius parse error: ${msg}`);
      }
    }
  );
}

function publishFieldDiagnosticsForDocument(
  doc: vscode.TextDocument,
  program: ReturnType<typeof analyzeSource>
): void {
  if (!fieldDiagnostics) {
    return;
  }

  const diagnostics = program.fieldValidationIssues.map((issue) => {
    const safeLine = Math.max(0, Math.min(issue.location.line, Math.max(0, doc.lineCount - 1)));
    const lineText = doc.lineAt(safeLine).text;
    const range = new vscode.Range(
      safeLine,
      0,
      safeLine,
      Math.max(1, lineText.length)
    );
    return new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Warning);
  });

  fieldDiagnostics.set(doc.uri, diagnostics);
}

function clearFieldDiagnostics(): void {
  fieldDiagnostics?.clear();
}

/**
 * Analyzes all RPGLE files in the current workspace folders.
 * Shows aggregate results in the tree.
 */
async function analyzeWorkspace(treeProvider: RpgeniusTreeProvider): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('RPGenius: No workspace folder is open.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🔍 RPGenius: Scanning workspace...',
      cancellable: false,
    },
    async (progress) => {
      try {
        // Find all RPGLE files
        const uriArrays = await Promise.all(
          workspaceFolders.map(wf => findRpgleFiles(wf))
        );
        const allUris = uriArrays.flat();

        if (allUris.length === 0) {
          vscode.window.showInformationMessage(
            'RPGenius: No supported source files found in workspace.'
          );
          return;
        }

        progress.report({ message: `Found ${allUris.length} file(s), parsing...` });

        // Parse each file
        const programs: ReturnType<typeof analyzeSource>[] = allUris
          .map((uri: vscode.Uri) => {
            const content = readFileSafe(uri.fsPath);
            if (!content) { return null; }
            try {
              return analyzeSource(content, uri.fsPath);
            } catch {
              return null;
            }
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);

        progress.report({ message: 'Building dependency graph...' });

        const _depGraph = buildDependencyGraphFromMany(programs);

        // Show the last (or active) file's program in the tree
        // In a full workspace view, you'd show a workspace-level root
        const active = getActiveEditorContent();
        const activeProgram = active
          ? programs.find((p) =>
              p.filePath === active.filePath ||
              active.filePath.endsWith(p.filePath)
            ) ?? programs[0]
          : programs[0];

        if (activeProgram) {
          treeProvider.setProgram(activeProgram, activeProgram.filePath);
        }

        updateStatusBar(`Workspace (${programs.length} files)`, {
          files: programs.reduce((n: number, p) => n + p.files.length, 0),
          calls: programs.reduce((n: number, p) => n + p.programCalls.length, 0),
          procs: programs.reduce((n: number, p) => n + p.procedures.length, 0),
          sql: programs.reduce((n: number, p) => n + p.sqlStatements.length, 0),
        });

        vscode.window.showInformationMessage(
          `✅ RPGenius: Analyzed ${programs.length} supported source file(s) in workspace.`
        );

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`❌ RPGenius workspace error: ${msg}`);
      }
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummaryMessage(
  program: ReturnType<typeof analyzeSource>
): string {
  const parts = [
    `${program.programName} [${program.sourceType ?? 'RPGLE'}]`,
    `${program.files.length} file(s)`,
    `${program.programCalls.length} call(s)`,
    `${program.procedures.length} procedure(s)`,
  ];
  if (program.sqlStatements.length > 0) {
    parts.push(`${program.sqlStatements.length} SQL stmt(s)`);
  }
  if (program.cursors.length > 0) {
    parts.push(`${program.cursors.length} cursor(s)`);
  }
  return parts.join(' · ');
}
