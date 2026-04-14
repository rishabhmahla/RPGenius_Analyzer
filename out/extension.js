"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const rpgleParser_1 = require("./rpgleParser");
const dependencyBuilder_1 = require("./dependencyBuilder");
const treeProvider_1 = require("./treeProvider");
const fileUtils_1 = require("./fileUtils");
// ─── Activation ───────────────────────────────────────────────────────────────
function activate(context) {
    console.log('RPGenius Analyzer is now active.');
    // ── Tree View Provider ─────────────────────────────────────────────────────
    const treeProvider = new treeProvider_1.RpgeniusTreeProvider();
    const treeView = vscode.window.createTreeView('rpgeniusAnalyzer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: false,
    });
    // ── Register Commands ──────────────────────────────────────────────────────
    // 1. Analyze current file
    const analyzeFileCmd = vscode.commands.registerCommand('rpgenius.analyzeFile', () => analyzeCurrentFile(treeProvider));
    // 2. Analyze all RPGLE files in workspace
    const analyzeWorkspaceCmd = vscode.commands.registerCommand('rpgenius.analyzeWorkspace', () => analyzeWorkspace(treeProvider));
    // 3. Internal: navigate to line (triggered by tree item click)
    const navigateCmd = vscode.commands.registerCommand('rpgenius.navigateToLine', (filePath, lineNumber) => (0, fileUtils_1.navigateToLine)(filePath, lineNumber));
    // 4. Refresh current view
    const refreshCmd = vscode.commands.registerCommand('rpgenius.refresh', () => {
        treeProvider.refresh();
        vscode.window.showInformationMessage('RPGenius: Tree refreshed.');
    });
    // 5. Clear results
    const clearCmd = vscode.commands.registerCommand('rpgenius.clearResults', () => {
        treeProvider.clear();
        vscode.window.showInformationMessage('RPGenius: Results cleared.');
    });
    // ── Auto-analyze on editor switch ─────────────────────────────────────────
    // When the active editor changes, auto-analyze if it's an RPGLE file and
    // we've already analyzed it before (use cache to avoid expensive re-parse).
    const onEditorChange = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) {
            return;
        }
        const filePath = editor.document.fileName;
        const cached = treeProvider.getCached(filePath);
        if (cached) {
            treeProvider.setProgram(cached, filePath);
            return;
        }
        // Auto-analyze recognized RPGLE files silently on first open
        if ((0, fileUtils_1.isRpgleFile)(filePath, editor.document.getText())) {
            analyzeCurrentFile(treeProvider, true /* silent */);
        }
    });
    // ── Auto-analyze on save ───────────────────────────────────────────────────
    const onSave = vscode.workspace.onDidSaveTextDocument(doc => {
        const filePath = doc.fileName;
        if ((0, fileUtils_1.isRpgleFile)(filePath, doc.getText())) {
            // Re-parse after save to keep the tree current
            const content = doc.getText();
            const program = (0, rpgleParser_1.parseRpgle)(content, filePath);
            treeProvider.setProgram(program, filePath);
            (0, fileUtils_1.updateStatusBar)(program.programName, {
                files: program.files.length,
                calls: program.programCalls.length,
                procs: program.procedures.length,
                sql: program.sqlStatements.length,
            });
        }
    });
    // ── Register all subscriptions ─────────────────────────────────────────────
    context.subscriptions.push(treeView, analyzeFileCmd, analyzeWorkspaceCmd, navigateCmd, refreshCmd, clearCmd, onEditorChange, onSave);
    // ── Analyze current file on activation (if one is open) ───────────────────
    if (vscode.window.activeTextEditor) {
        const editor = vscode.window.activeTextEditor;
        if ((0, fileUtils_1.isRpgleFile)(editor.document.fileName, editor.document.getText())) {
            analyzeCurrentFile(treeProvider, true /* silent */);
        }
    }
}
// ─── Deactivation ─────────────────────────────────────────────────────────────
function deactivate() {
    (0, fileUtils_1.disposeDecorations)();
    (0, fileUtils_1.disposeStatusBar)();
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
async function analyzeCurrentFile(treeProvider, silent = false) {
    const active = (0, fileUtils_1.getActiveEditorContent)();
    if (!active) {
        if (!silent) {
            vscode.window.showWarningMessage('RPGenius: No active editor. Please open an RPGLE file.');
        }
        return;
    }
    const { content, filePath } = active;
    if (!(0, fileUtils_1.isRpgleFile)(filePath, content)) {
        if (!silent) {
            vscode.window.showWarningMessage(`RPGenius: "${filePath.split('/').pop()}" doesn't look like an RPGLE file. ` +
                `Use a .rpgle/.rpg extension or ensure the file contains RPGLE source.`);
        }
        return;
    }
    (0, fileUtils_1.showAnalyzingStatus)();
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '🔍 RPGenius: Analyzing RPGLE file...',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: 'Parsing source...' });
        try {
            // Parse the source
            const program = (0, rpgleParser_1.parseRpgle)(content, filePath);
            progress.report({ message: 'Building dependency model...' });
            // Build dependency graph (used for future cross-file features)
            const _depGraph = (0, dependencyBuilder_1.buildDependencyGraph)(program);
            progress.report({ message: 'Updating tree view...' });
            // Update sidebar tree
            treeProvider.setProgram(program, filePath);
            // Update status bar
            (0, fileUtils_1.updateStatusBar)(program.programName, {
                files: program.files.length,
                calls: program.programCalls.length,
                procs: program.procedures.length,
                sql: program.sqlStatements.length,
            });
            // Show warnings if any
            if (program.warnings.length > 0 && !silent) {
                vscode.window.showWarningMessage(`RPGenius: Analysis complete with ${program.warnings.length} warning(s). ` +
                    program.warnings[0].message);
            }
            else if (!silent) {
                const summary = buildSummaryMessage(program);
                vscode.window.showInformationMessage(`✅ RPGenius: ${summary}`);
            }
            // Show panel
            await vscode.commands.executeCommand('rpgeniusAnalyzer.focus');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`❌ RPGenius parse error: ${msg}`);
        }
    });
}
/**
 * Analyzes all RPGLE files in the current workspace folders.
 * Shows aggregate results in the tree.
 */
async function analyzeWorkspace(treeProvider) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('RPGenius: No workspace folder is open.');
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '🔍 RPGenius: Scanning workspace...',
        cancellable: false,
    }, async (progress) => {
        try {
            // Find all RPGLE files
            const uriArrays = await Promise.all(workspaceFolders.map(wf => (0, fileUtils_1.findRpgleFiles)(wf)));
            const allUris = uriArrays.flat();
            if (allUris.length === 0) {
                vscode.window.showInformationMessage('RPGenius: No RPGLE files found in workspace (looked for .rpgle, .rpg).');
                return;
            }
            progress.report({ message: `Found ${allUris.length} file(s), parsing...` });
            // Parse each file
            const programs = allUris
                .map((uri) => {
                const content = (0, fileUtils_1.readFileSafe)(uri.fsPath);
                if (!content) {
                    return null;
                }
                try {
                    return (0, rpgleParser_1.parseRpgle)(content, uri.fsPath);
                }
                catch {
                    return null;
                }
            })
                .filter((p) => p !== null);
            progress.report({ message: 'Building dependency graph...' });
            const _depGraph = (0, dependencyBuilder_1.buildDependencyGraphFromMany)(programs);
            // Show the last (or active) file's program in the tree
            // In a full workspace view, you'd show a workspace-level root
            const active = (0, fileUtils_1.getActiveEditorContent)();
            const activeProgram = active
                ? programs.find((p) => p.filePath === active.filePath) ?? programs[0]
                : programs[0];
            if (activeProgram) {
                treeProvider.setProgram(activeProgram, activeProgram.filePath);
            }
            (0, fileUtils_1.updateStatusBar)(`Workspace (${programs.length} files)`, {
                files: programs.reduce((n, p) => n + p.files.length, 0),
                calls: programs.reduce((n, p) => n + p.programCalls.length, 0),
                procs: programs.reduce((n, p) => n + p.procedures.length, 0),
                sql: programs.reduce((n, p) => n + p.sqlStatements.length, 0),
            });
            vscode.window.showInformationMessage(`✅ RPGenius: Analyzed ${programs.length} RPGLE file(s) in workspace.`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`❌ RPGenius workspace error: ${msg}`);
        }
    });
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildSummaryMessage(program) {
    const parts = [
        `${program.programName}`,
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
//# sourceMappingURL=extension.js.map