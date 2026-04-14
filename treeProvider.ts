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

import * as vscode from 'vscode';
import { RpgleProgram, SourceLocation } from './models';

// ─── Tree Item Types ──────────────────────────────────────────────────────────

export type TreeItemKind =
  | 'root'
  | 'category'
  | 'file'
  | 'copybook'
  | 'call'
  | 'procedure'
  | 'dataStructure'
  | 'subfield'
  | 'sqlStatement'
  | 'cursor'
  | 'variable'
  | 'prototype'
  | 'empty'
  | 'message';

/**
 * A single item in the RPGenius tree view.
 * Extends vscode.TreeItem so VS Code can render it.
 */
export class RpgTreeItem extends vscode.TreeItem {
  public readonly kind: TreeItemKind;
  public readonly children: RpgTreeItem[];
  public readonly sourceLocation?: SourceLocation;
  public readonly filePath?: string;

  constructor(
    label: string,
    kind: TreeItemKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
    children: RpgTreeItem[] = [],
    sourceLocation?: SourceLocation,
    filePath?: string,
    description?: string,
    tooltip?: string,
  ) {
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

// ─── Icon Mapping ─────────────────────────────────────────────────────────────

function getThemeIcon(kind: TreeItemKind): vscode.ThemeIcon {
  switch (kind) {
    case 'root':          return new vscode.ThemeIcon('file-code');
    case 'category':      return new vscode.ThemeIcon('list-tree');
    case 'file':          return new vscode.ThemeIcon('database');
    case 'copybook':      return new vscode.ThemeIcon('library');
    case 'call':          return new vscode.ThemeIcon('call-outgoing');
    case 'procedure':     return new vscode.ThemeIcon('symbol-method');
    case 'dataStructure': return new vscode.ThemeIcon('symbol-structure');
    case 'subfield':      return new vscode.ThemeIcon('symbol-field');
    case 'sqlStatement':  return new vscode.ThemeIcon('server');
    case 'cursor':        return new vscode.ThemeIcon('arrow-swap');
    case 'variable':      return new vscode.ThemeIcon('symbol-variable');
    case 'prototype':     return new vscode.ThemeIcon('symbol-interface');
    case 'empty':         return new vscode.ThemeIcon('dash');
    case 'message':       return new vscode.ThemeIcon('info');
    default:              return new vscode.ThemeIcon('circle-outline');
  }
}

// ─── Tree Builder ─────────────────────────────────────────────────────────────

/**
 * Builds the full tree from a parsed RpgleProgram.
 */
function buildTree(program: RpgleProgram, filePath: string): RpgTreeItem[] {
  const root = new RpgTreeItem(
    `${program.programName}`,
    'root',
    vscode.TreeItemCollapsibleState.Expanded,
    [],
    undefined,
    undefined,
    `[${program.sourceFormat}] · ${program.totalLines} lines`,
    `${program.programName} — ${program.sourceFormat} format · ${program.totalLines} lines · Parsed at ${program.parsedAt.toLocaleTimeString()}`
  );

  // ── Files ──────────────────────────────────────────────────────────────────
  const fileItems = program.files.map(f => {
    const typeStr = f.fileType !== 'UNKNOWN' ? f.fileType : '?';
    const label = f.name;
    const desc = `${f.usage} / ${typeStr}${f.isDisplayFile ? ' · DSPF' : ''}${f.isPrinterFile ? ' · PRTF' : ''}${f.keyed ? ' · Keyed' : ''}`;
    return new RpgTreeItem(label, 'file', vscode.TreeItemCollapsibleState.None, [], f.location, filePath, desc,
      `File: ${f.name}\nUsage: ${f.usage}\nType: ${typeStr}\nLine: ${f.location.line + 1}\n${f.location.rawLine.trim()}`
    );
  });

  root.children.push(
    makeCategory('Files', 'database', fileItems, filePath)
  );

  // ── Copybooks ──────────────────────────────────────────────────────────────
  const cbItems = program.copybooks.map(cb => {
    const name = cb.library ? `${cb.library}/${cb.member}` : cb.member;
    return new RpgTreeItem(name, 'copybook', vscode.TreeItemCollapsibleState.None, [], cb.location, filePath, undefined,
      `Copybook: ${name}\nLine: ${cb.location.line + 1}\n${cb.location.rawLine.trim()}`
    );
  });

  root.children.push(
    makeCategory('Copybooks', 'library', cbItems, filePath)
  );

  // ── Programs Called ────────────────────────────────────────────────────────
  const callItems = program.programCalls.map(c => {
    return new RpgTreeItem(c.programName, 'call', vscode.TreeItemCollapsibleState.None, [], c.location, filePath, c.callType,
      `CALL: ${c.programName} (${c.callType})\nLine: ${c.location.line + 1}\n${c.location.rawLine.trim()}`
    );
  });

  root.children.push(
    makeCategory('Programs Called', 'call-outgoing', callItems, filePath)
  );

  // ── Procedures ────────────────────────────────────────────────────────────
  const procItems = program.procedures.map(p => {
    const params = p.parameters.map(param =>
      new RpgTreeItem(
        `${param.name} : ${param.type}`,
        'subfield',
        vscode.TreeItemCollapsibleState.None,
        [],
        p.startLocation,
        filePath,
        param.direction,
      )
    );

    const label = p.name;
    const desc = [
      p.returnType ? `→ ${p.returnType}` : '',
      p.isExported ? 'EXPORT' : '',
      `(${p.parameters.length} params)`,
    ].filter(Boolean).join(' · ');

    const endLine = p.endLocation ? ` → L${p.endLocation.line + 1}` : '';
    return new RpgTreeItem(
      label,
      'procedure',
      params.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      params,
      p.startLocation,
      filePath,
      desc,
      `Procedure: ${p.name}\nLine: ${p.startLocation.line + 1}${endLine}\n${p.startLocation.rawLine.trim()}`
    );
  });

  root.children.push(
    makeCategory('Procedures', 'symbol-method', procItems, filePath)
  );

  // ── Data Structures ────────────────────────────────────────────────────────
  const dsItems = program.dataStructures.map(ds => {
    const sfItems = ds.subfields.map(sf =>
      new RpgTreeItem(
        `${sf.name}${sf.type ? ' : ' + sf.type : ''}`,
        'subfield',
        vscode.TreeItemCollapsibleState.None,
        [],
        sf.location,
        filePath,
      )
    );

    const desc = [
      ds.dsType,
      ds.likeBase ? `LikeDS(${ds.likeBase})` : '',
      ds.qualified ? 'Qualified' : '',
      `${ds.subfields.length} subfields`,
    ].filter(Boolean).join(' · ');

    return new RpgTreeItem(
      ds.name,
      'dataStructure',
      sfItems.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      sfItems,
      ds.startLocation,
      filePath,
      desc,
      `Data Structure: ${ds.name}\nType: ${ds.dsType}\nLine: ${ds.startLocation.line + 1}`
    );
  });

  root.children.push(
    makeCategory('Data Structures', 'symbol-structure', dsItems, filePath)
  );

  // ── SQL Statements ─────────────────────────────────────────────────────────
  const sqlItems = program.sqlStatements.map((s, idx) => {
    const preview = s.text.substring(0, 60) + (s.text.length > 60 ? '…' : '');
    return new RpgTreeItem(
      `${s.statementType} #${idx + 1}`,
      'sqlStatement',
      vscode.TreeItemCollapsibleState.None,
      [],
      s.location,
      filePath,
      preview,
      `SQL ${s.statementType}\nLine: ${s.location.line + 1}\n\n${s.text}`
    );
  });

  root.children.push(
    makeCategory('SQL Statements', 'server', sqlItems, filePath)
  );

  // ── Cursors ────────────────────────────────────────────────────────────────
  const cursorItems = program.cursors.map(c => {
    const preview = c.selectText.substring(0, 60) + (c.selectText.length > 60 ? '…' : '');
    return new RpgTreeItem(
      c.name,
      'cursor',
      vscode.TreeItemCollapsibleState.None,
      [],
      c.location,
      filePath,
      preview,
      `Cursor: ${c.name}\nLine: ${c.location.line + 1}\n\nFOR ${c.selectText}`
    );
  });

  root.children.push(
    makeCategory('Cursors', 'arrow-swap', cursorItems, filePath)
  );

  // ── Variables ──────────────────────────────────────────────────────────────
  const varItems = program.variables.map(v => {
    const desc = [
      v.varType,
      v.isConstant ? 'CONST' : '',
      v.initialValue ? `= ${v.initialValue}` : '',
    ].filter(Boolean).join(' · ');

    return new RpgTreeItem(
      v.name,
      'variable',
      vscode.TreeItemCollapsibleState.None,
      [],
      v.location,
      filePath,
      desc,
      `Variable: ${v.name}\nType: ${v.varType}\nLine: ${v.location.line + 1}`
    );
  });

  root.children.push(
    makeCategory('Variables', 'symbol-variable', varItems, filePath)
  );

  // ── Prototypes ─────────────────────────────────────────────────────────────
  const prItems = program.prototypes.map(pr => {
    const desc = pr.externalName ? `ExtPgm(${pr.externalName})` : `${pr.parameters.length} params`;
    return new RpgTreeItem(
      pr.name,
      'prototype',
      vscode.TreeItemCollapsibleState.None,
      [],
      pr.location,
      filePath,
      desc,
      `Prototype: ${pr.name}\nExternal: ${pr.externalName ?? 'n/a'}\nLine: ${pr.location.line + 1}`
    );
  });

  root.children.push(
    makeCategory('Prototypes', 'symbol-interface', prItems, filePath)
  );

  return [root];
}

/**
 * Creates a collapsible category node with a count badge.
 */
function makeCategory(
  label: string,
  iconId: string,
  children: RpgTreeItem[],
  _filePath: string
): RpgTreeItem {
  const hasItems = children.length > 0;
  const cat = new RpgTreeItem(
    label,
    'category',
    hasItems
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
    children,
    undefined,
    undefined,
    `(${children.length})`,
    `${label}: ${children.length} item${children.length !== 1 ? 's' : ''}`
  );
  cat.iconPath = new vscode.ThemeIcon(iconId);
  if (!hasItems) {
    // Add an "(empty)" child so the category is clearly visible
    children.push(new RpgTreeItem('(none found)', 'empty', vscode.TreeItemCollapsibleState.None));
  }
  return cat;
}

// ─── Tree Data Provider ───────────────────────────────────────────────────────

export class RpgeniusTreeProvider implements vscode.TreeDataProvider<RpgTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RpgTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Currently displayed program data */
  private currentProgram: RpgleProgram | null = null;
  private currentFilePath: string | null = null;

  /** Cache: file path → parsed result */
  private cache = new Map<string, RpgleProgram>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Updates the tree with a newly parsed program.
   */
  setProgram(program: RpgleProgram, filePath: string): void {
    this.currentProgram = program;
    this.currentFilePath = filePath;
    this.cache.set(filePath, program);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Clears the current display (e.g., when no file is open).
   */
  clear(): void {
    this.currentProgram = null;
    this.currentFilePath = null;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Forces a refresh of the current file (e.g., after save).
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the cached parse result for a file, if available.
   */
  getCached(filePath: string): RpgleProgram | undefined {
    return this.cache.get(filePath);
  }

  /**
   * Returns all currently cached programs (for workspace analysis).
   */
  getAllCached(): RpgleProgram[] {
    return Array.from(this.cache.values());
  }

  // ── TreeDataProvider Implementation ────────────────────────────────────────

  getTreeItem(element: RpgTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RpgTreeItem): RpgTreeItem[] {
    // Root call — build from current program
    if (!element) {
      if (!this.currentProgram || !this.currentFilePath) {
        return [
          new RpgTreeItem(
            'No RPGLE file analyzed yet',
            'message',
            vscode.TreeItemCollapsibleState.None,
            [],
            undefined,
            undefined,
            'Run "Analyze RPG Program" to start'
          ),
        ];
      }
      return buildTree(this.currentProgram, this.currentFilePath);
    }

    return element.children;
  }

  getParent(_element: RpgTreeItem): vscode.ProviderResult<RpgTreeItem> {
    // Not implementing full parent tracking — not needed for this use case
    return null;
  }
}
