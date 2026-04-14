"use strict";
/**
 * treeProvider.ts
 * Implements the VS Code TreeDataProvider for the "RPGenius Analyzer" sidebar.
 *
 * Tree structure:
 *   📄 MYPGM  [FREE]
 *   ├── 📚 Files (3)
 *   │   ├── ORDHDR  [I / DISK]
 *   │   └── INVHDR  [O / DISK]
 *   ├── 📋 Copybooks (2)
 *   ├── 📞 Programs Called (1)
 *   ├── ⚙️  Procedures (4)
 *   ├── 🗂️  Data Structures (2)
 *   ├── 🗄️  SQL Statements (5)
 *   └── 🔄 Cursors (1)
 *
 * Clicking a leaf node → navigates to the source line.
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
exports.RpgeniusTreeProvider = exports.RpgTreeItem = void 0;
const vscode = __importStar(require("vscode"));
/**
 * A single item in the RPGenius tree view.
 * Extends vscode.TreeItem so VS Code can render it.
 */
class RpgTreeItem extends vscode.TreeItem {
    kind;
    children;
    sourceLocation;
    filePath;
    constructor(label, kind, collapsibleState, children = [], sourceLocation, filePath, description, tooltip) {
        super(label, collapsibleState);
        this.kind = kind;
        this.children = children;
        this.sourceLocation = sourceLocation;
        this.filePath = filePath;
        this.description = description;
        this.tooltip = tooltip ?? label;
        // Assign icon and context value based on kind
        this.iconPath = getThemeIcon(kind);
        this.contextValue = kind;
        // Leaf nodes with a location get a command to navigate to source
        if (sourceLocation !== undefined && filePath) {
            this.command = {
                command: 'rpgenius.navigateToLine',
                title: 'Go to Source',
                arguments: [filePath, sourceLocation.line],
            };
        }
    }
}
exports.RpgTreeItem = RpgTreeItem;
// ─── Icon Mapping ─────────────────────────────────────────────────────────────
function getThemeIcon(kind) {
    switch (kind) {
        case 'root': return new vscode.ThemeIcon('file-code');
        case 'category': return new vscode.ThemeIcon('list-tree');
        case 'file': return new vscode.ThemeIcon('database');
        case 'copybook': return new vscode.ThemeIcon('library');
        case 'call': return new vscode.ThemeIcon('call-outgoing');
        case 'procedure': return new vscode.ThemeIcon('symbol-method');
        case 'dataStructure': return new vscode.ThemeIcon('symbol-structure');
        case 'subfield': return new vscode.ThemeIcon('symbol-field');
        case 'sqlStatement': return new vscode.ThemeIcon('server');
        case 'cursor': return new vscode.ThemeIcon('arrow-swap');
        case 'variable': return new vscode.ThemeIcon('symbol-variable');
        case 'prototype': return new vscode.ThemeIcon('symbol-interface');
        case 'empty': return new vscode.ThemeIcon('dash');
        case 'message': return new vscode.ThemeIcon('info');
        default: return new vscode.ThemeIcon('circle-outline');
    }
}
// ─── Tree Builder ─────────────────────────────────────────────────────────────
/**
 * Builds the full tree from a parsed RpgleProgram.
 * Categories shown depend on sourceType for relevance.
 */
function buildTree(program, filePath) {
    const sourceType = program.sourceType ?? 'RPGLE';
    const root = new RpgTreeItem(`${program.programName}`, 'root', vscode.TreeItemCollapsibleState.Expanded, [], undefined, undefined, `[${sourceType} | ${program.sourceFormat}] · ${program.totalLines} lines`, `${program.programName} — ${sourceType} · ${program.sourceFormat} format · ${program.totalLines} lines · Parsed at ${program.parsedAt.toLocaleTimeString()}`);
    // ─── Source-specific tree building ───────────────────────────────────────
    if (sourceType === 'PF_DDS' || sourceType === 'DSPF_DDS') {
        buildDdsTree(program, filePath, root);
    }
    else if (sourceType === 'CLLE' || sourceType === 'CL38') {
        buildClTree(program, filePath, root);
    }
    else {
        buildRpgleTree(program, filePath, root);
    }
    return [root];
}
/**
 * Build tree for RPGLE/SQLRPGLE programs (full analysis).
 */
function buildRpgleTree(program, filePath, root) {
    // ── Files ──────────────────────────────────────────────────────────────────
    const fileItems = program.files.map(f => {
        const typeStr = f.fileType !== 'UNKNOWN' ? f.fileType : '?';
        const label = f.name;
        const resolved = f.resolvedObject
            ? ` · ${f.resolvedObject.library}/${f.resolvedObject.objectName}`
            : '';
        const desc = `${f.usage} / ${typeStr}${f.isDisplayFile ? ' · DSPF' : ''}${f.isPrinterFile ? ' · PRTF' : ''}${f.keyed ? ' · Keyed' : ''}`;
        const item = new RpgTreeItem(label, 'file', vscode.TreeItemCollapsibleState.None, [], f.location, filePath, `${desc}${resolved}`, `File: ${f.name}\nUsage: ${f.usage}\nType: ${typeStr}\n${f.resolvedObject ? `Resolved: ${f.resolvedObject.library}/${f.resolvedObject.objectName} (${f.resolvedObject.objectType})\n` : ''}Line: ${f.location.line + 1}\n${f.location.rawLine.trim()}`);
        if (f.resolvedObject?.library) {
            item.command = {
                command: 'rpgenius.openIbmiObjectSource',
                title: 'Open IBM i Source',
                arguments: [f.resolvedObject],
            };
        }
        return item;
    });
    root.children.push(makeCategory('Files', 'database', fileItems, filePath));
    // ── Copybooks ──────────────────────────────────────────────────────────────
    const cbItems = program.copybooks.map(cb => {
        const name = cb.library ? `${cb.library}/${cb.member}` : cb.member;
        return new RpgTreeItem(name, 'copybook', vscode.TreeItemCollapsibleState.None, [], cb.location, filePath, undefined, `Copybook: ${name}\nLine: ${cb.location.line + 1}\n${cb.location.rawLine.trim()}`);
    });
    root.children.push(makeCategory('Copybooks', 'library', cbItems, filePath));
    // ── Programs Called ────────────────────────────────────────────────────────
    const callItems = program.programCalls.map(c => {
        const desc = c.resolvedObject
            ? `${c.callType} · ${c.resolvedObject.library}/${c.resolvedObject.objectName}`
            : c.callType;
        const item = new RpgTreeItem(c.programName, 'call', vscode.TreeItemCollapsibleState.None, [], c.location, filePath, desc, `CALL: ${c.programName} (${c.callType})\n${c.resolvedObject ? `Resolved: ${c.resolvedObject.library}/${c.resolvedObject.objectName} (${c.resolvedObject.objectType})\n` : ''}Line: ${c.location.line + 1}\n${c.location.rawLine.trim()}`);
        if (c.resolvedObject?.library) {
            item.command = {
                command: 'rpgenius.openIbmiObjectSource',
                title: 'Open IBM i Source',
                arguments: [c.resolvedObject],
            };
        }
        return item;
    });
    root.children.push(makeCategory('Programs Called', 'call-outgoing', callItems, filePath));
    // ── Procedures ────────────────────────────────────────────────────────────
    const procItems = program.procedures.map(p => {
        const params = p.parameters.map(param => new RpgTreeItem(`${param.name} : ${param.type}`, 'subfield', vscode.TreeItemCollapsibleState.None, [], p.startLocation, filePath, param.direction));
        const label = p.name;
        const desc = [
            p.returnType ? `→ ${p.returnType}` : '',
            p.isExported ? 'EXPORT' : '',
            `(${p.parameters.length} params)`,
        ].filter(Boolean).join(' · ');
        const endLine = p.endLocation ? ` → L${p.endLocation.line + 1}` : '';
        return new RpgTreeItem(label, 'procedure', params.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, params, p.startLocation, filePath, desc, `Procedure: ${p.name}\nLine: ${p.startLocation.line + 1}${endLine}\n${p.startLocation.rawLine.trim()}`);
    });
    root.children.push(makeCategory('Procedures', 'symbol-method', procItems, filePath));
    // ── Data Structures ────────────────────────────────────────────────────────
    const dsItems = program.dataStructures.map(ds => {
        const sfItems = ds.subfields.map(sf => new RpgTreeItem(`${sf.name}${sf.type ? ' : ' + sf.type : ''}`, 'subfield', vscode.TreeItemCollapsibleState.None, [], sf.location, filePath));
        const desc = [
            ds.dsType,
            ds.likeBase ? `LikeDS(${ds.likeBase})` : '',
            ds.qualified ? 'Qualified' : '',
            `${ds.subfields.length} subfields`,
        ].filter(Boolean).join(' · ');
        return new RpgTreeItem(ds.name, 'dataStructure', sfItems.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, sfItems, ds.startLocation, filePath, desc, `Data Structure: ${ds.name}\nType: ${ds.dsType}\nLine: ${ds.startLocation.line + 1}`);
    });
    root.children.push(makeCategory('Data Structures', 'symbol-structure', dsItems, filePath));
    // ── SQL Statements ─────────────────────────────────────────────────────────
    const sqlItems = program.sqlStatements.map((s, idx) => {
        const preview = s.text.substring(0, 60) + (s.text.length > 60 ? '…' : '');
        return new RpgTreeItem(`${s.statementType} #${idx + 1}`, 'sqlStatement', vscode.TreeItemCollapsibleState.None, [], s.location, filePath, preview, `SQL ${s.statementType}\nLine: ${s.location.line + 1}\n\n${s.text}`);
    });
    root.children.push(makeCategory('SQL Statements', 'server', sqlItems, filePath));
    // ── Cursors ────────────────────────────────────────────────────────────────
    const cursorItems = program.cursors.map(c => {
        const preview = c.selectText.substring(0, 60) + (c.selectText.length > 60 ? '…' : '');
        return new RpgTreeItem(c.name, 'cursor', vscode.TreeItemCollapsibleState.None, [], c.location, filePath, preview, `Cursor: ${c.name}\nLine: ${c.location.line + 1}\n\nFOR ${c.selectText}`);
    });
    root.children.push(makeCategory('Cursors', 'arrow-swap', cursorItems, filePath));
    // ── Variables ──────────────────────────────────────────────────────────────
    const varItems = program.variables.map(v => {
        const desc = [
            v.varType,
            v.isConstant ? 'CONST' : '',
            v.initialValue ? `= ${v.initialValue}` : '',
        ].filter(Boolean).join(' · ');
        return new RpgTreeItem(v.name, 'variable', vscode.TreeItemCollapsibleState.None, [], v.location, filePath, desc, `Variable: ${v.name}\nType: ${v.varType}\nLine: ${v.location.line + 1}`);
    });
    root.children.push(makeCategory('Variables', 'symbol-variable', varItems, filePath));
    // ── Prototypes ─────────────────────────────────────────────────────────────
    const prItems = program.prototypes.map(pr => {
        const desc = pr.externalName ? `ExtPgm(${pr.externalName})` : `${pr.parameters.length} params`;
        return new RpgTreeItem(pr.name, 'prototype', vscode.TreeItemCollapsibleState.None, [], pr.location, filePath, desc, `Prototype: ${pr.name}\nExternal: ${pr.externalName ?? 'n/a'}\nLine: ${pr.location.line + 1}`);
    });
    root.children.push(makeCategory('Prototypes', 'symbol-interface', prItems, filePath));
    // ── Field Validation Issues ───────────────────────────────────────────────
    const issueItems = program.fieldValidationIssues.map(issue => {
        return new RpgTreeItem(`${issue.fileName}.${issue.fieldName}`, 'message', vscode.TreeItemCollapsibleState.None, [], issue.location, filePath, `Line ${issue.location.line + 1}`, `${issue.message}\nLine: ${issue.location.line + 1}\n${issue.location.rawLine.trim()}`);
    });
    root.children.push(makeCategory('Field Validation Issues', 'warning', issueItems, filePath));
}
/**
 * Build tree for CLLE/CL38 programs (c-specific analysis, simplified).
 */
function buildClTree(program, filePath, root) {
    // Only show relevant categories for CL
    // ── Variables ──────────────────────────────────────────────────────────────
    const varItems = program.variables.map(v => {
        const desc = v.varType;
        return new RpgTreeItem(v.name, 'variable', vscode.TreeItemCollapsibleState.None, [], v.location, filePath, desc, `Variable: ${v.name}\nType: ${v.varType}\nLine: ${v.location.line + 1}`);
    });
    if (varItems.length > 0) {
        root.children.push(makeCategory('Variables', 'symbol-variable', varItems, filePath));
    }
    // ── Files (OVR overrides) ──────────────────────────────────────────────────
    const fileItems = program.files.map(f => {
        const typeStr = f.fileType !== 'UNKNOWN' ? f.fileType : '?';
        const label = f.name;
        const desc = `${f.usage} / ${typeStr}`;
        return new RpgTreeItem(label, 'file', vscode.TreeItemCollapsibleState.None, [], f.location, filePath, desc, `File: ${f.name}\nUsage: ${f.usage}\nType: ${typeStr}\nLine: ${f.location.line + 1}\n${f.location.rawLine.trim()}`);
    });
    if (fileItems.length > 0) {
        root.children.push(makeCategory('Files (Overrides)', 'database', fileItems, filePath));
    }
    // ── Programs Called ────────────────────────────────────────────────────────
    const callItems = program.programCalls.map(c => {
        return new RpgTreeItem(c.programName, 'call', vscode.TreeItemCollapsibleState.None, [], c.location, filePath, c.callType, `CALL: ${c.programName} (${c.callType})\nLine: ${c.location.line + 1}\n${c.location.rawLine.trim()}`);
    });
    if (callItems.length > 0) {
        root.children.push(makeCategory('Programs Called', 'call-outgoing', callItems, filePath));
    }
}
/**
 * Build tree for PF/DSPF DDS sources (file-specific analysis).
 */
function buildDdsTree(program, filePath, root) {
    // ── Record Formats / Fields ────────────────────────────────────────────────
    const dsItems = program.dataStructures.map(ds => {
        const sfItems = ds.subfields.map(sf => {
            const attrStr = sf.attributes
                ? Object.entries(sf.attributes)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')
                : '';
            const lenStr = sf.length ? ` (${sf.length}${sf.decimals ? `,${sf.decimals}` : ''})` : '';
            const label = `${sf.name} : ${sf.type}${lenStr}`;
            const heading = sf.columnHeading ? `\nColumn Heading: ${sf.columnHeading}` : '';
            return new RpgTreeItem(label, 'subfield', vscode.TreeItemCollapsibleState.None, [], sf.location, filePath, attrStr || sf.type, `Field: ${sf.name}\nType: ${sf.type}${lenStr}${heading}\nAttributes: ${attrStr || 'none'}\nLine: ${sf.location.line + 1}`);
        });
        const desc = `${ds.subfields.length} field${ds.subfields.length !== 1 ? 's' : ''}`;
        return new RpgTreeItem(ds.name, 'dataStructure', sfItems.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None, sfItems, ds.startLocation, filePath, desc, `Record Format: ${ds.name}\nLine: ${ds.startLocation.line + 1}`);
    });
    root.children.push(makeCategory('Record Formats', 'symbol-structure', dsItems, filePath));
    // ── Keys ───────────────────────────────────────────────────────────────────
    const keyItems = program.ddsKeys.map(key => {
        return new RpgTreeItem(key.name, 'subfield', vscode.TreeItemCollapsibleState.None, [], key.location, filePath, `${key.keyType} · ${key.keyFields.join(', ')}`, `Key: ${key.name}\nType: ${key.keyType}\nFields: ${key.keyFields.join(', ')}\nLine: ${key.location.line + 1}`);
    });
    if (keyItems.length > 0) {
        root.children.push(makeCategory('Keys', 'symbol-constant', keyItems, filePath));
    }
    // ── Visualization option for DSPF ─────────────────────────────────────────
    if (program.sourceType === 'DSPF_DDS') {
        const vizItem = new RpgTreeItem('View Green-Screen Preview', 'message', vscode.TreeItemCollapsibleState.None, [], { line: 0, rawLine: '' }, undefined, 'Click to visualize', 'View this DSPF as a 5250 green-screen terminal');
        vizItem.command = {
            command: 'rpgenius.visualizeSource',
            title: 'Visualize DSPF',
            arguments: [],
        };
        root.children.push(vizItem);
    }
    // ── Visualization option for PF ──────────────────────────────────────────
    if (program.sourceType === 'PF_DDS') {
        const vizItem = new RpgTreeItem('View Tabular Preview', 'message', vscode.TreeItemCollapsibleState.None, [], { line: 0, rawLine: '' }, undefined, 'Click to visualize', 'View this PF fields as a table');
        vizItem.command = {
            command: 'rpgenius.visualizeSource',
            title: 'Visualize PF',
            arguments: [],
        };
        root.children.push(vizItem);
    }
}
/**
 * Builds tree categories from a root item and returns as final array.
 * Called at the end of buildTree.
 */
function finalizeTree(root) {
    return [root];
}
/**
 * Creates a collapsible category node with a count badge.
 */
function makeCategory(label, iconId, children, _filePath) {
    const hasItems = children.length > 0;
    const cat = new RpgTreeItem(label, 'category', hasItems
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None, children, undefined, undefined, `(${children.length})`, `${label}: ${children.length} item${children.length !== 1 ? 's' : ''}`);
    cat.iconPath = new vscode.ThemeIcon(iconId);
    if (!hasItems) {
        // Add an "(empty)" child so the category is clearly visible
        children.push(new RpgTreeItem('(none found)', 'empty', vscode.TreeItemCollapsibleState.None));
    }
    return cat;
}
// ─── Tree Data Provider ───────────────────────────────────────────────────────
class RpgeniusTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    /** Currently displayed program data */
    currentProgram = null;
    currentFilePath = null;
    /** Cache: file path → parsed result */
    cache = new Map();
    // ── Public API ─────────────────────────────────────────────────────────────
    /**
     * Updates the tree with a newly parsed program.
     */
    setProgram(program, filePath) {
        this.currentProgram = program;
        this.currentFilePath = filePath;
        this.cache.set(filePath, program);
        this._onDidChangeTreeData.fire();
    }
    /**
     * Clears the current display (e.g., when no file is open).
     */
    clear() {
        this.currentProgram = null;
        this.currentFilePath = null;
        this._onDidChangeTreeData.fire();
    }
    /**
     * Forces a refresh of the current file (e.g., after save).
     */
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    /**
     * Returns the cached parse result for a file, if available.
     */
    getCached(filePath) {
        return this.cache.get(filePath);
    }
    /**
     * Returns all currently cached programs (for workspace analysis).
     */
    getAllCached() {
        return Array.from(this.cache.values());
    }
    // ── TreeDataProvider Implementation ────────────────────────────────────────
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        // Root call — build from current program
        if (!element) {
            if (!this.currentProgram || !this.currentFilePath) {
                return [
                    new RpgTreeItem('No RPGLE file analyzed yet', 'message', vscode.TreeItemCollapsibleState.None, [], undefined, undefined, 'Run "Analyze RPG Program" to start'),
                ];
            }
            return buildTree(this.currentProgram, this.currentFilePath);
        }
        return element.children;
    }
    getParent(_element) {
        // Not implementing full parent tracking — not needed for this use case
        return null;
    }
}
exports.RpgeniusTreeProvider = RpgeniusTreeProvider;
//# sourceMappingURL=treeProvider.js.map