# 🔍 RPGenius Analyzer

A production-grade VS Code extension that **statically analyzes RPGLE source code** and generates a complete program map — with zero AI, zero external APIs, and zero faking.

---

## ✨ What It Does

Parses your RPGLE source line-by-line and extracts:

| Element | Fixed Format | Free Format |
|---|---|---|
| `/COPY` & `/INCLUDE` copybooks | ✅ | ✅ |
| `F`-spec / `DCL-F` file declarations | ✅ | ✅ |
| `CALL` / `CALLP` / `CALLB` program calls | ✅ | ✅ |
| `DCL-PROC` / `P`-spec procedures | ✅ | ✅ |
| `DCL-DS` / `D`-spec data structures | ✅ | ✅ |
| `DCL-S` / `DCL-C` variables & constants | ✅ | ✅ |
| `DCL-PR` / `D PR` prototypes | ✅ | ✅ |
| `EXEC SQL` statements (multi-line) | ✅ | ✅ |
| `DECLARE CURSOR FOR` cursors | ✅ | ✅ |
| Mixed `**FREE` + fixed sections | ✅ | ✅ |

Everything is shown in a **sidebar tree view** with click-to-navigate to source lines.

---

## 📁 Project Structure

```
rpgenius-analyzer/
├── src/
│   ├── extension.ts                  ← Entry point, command wiring, event hooks
│   ├── parser/
│   │   ├── models.ts                 ← All TypeScript interfaces (RpgleProgram, etc.)
│   │   ├── regexRules.ts             ← All regex patterns, centralized & documented
│   │   └── rpgleParser.ts            ← Core line-by-line parsing engine
│   ├── analyzer/
│   │   └── dependencyBuilder.ts      ← Builds program dependency graph
│   ├── views/
│   │   └── treeProvider.ts           ← VS Code TreeDataProvider + item builder
│   └── utils/
│       └── fileUtils.ts              ← File I/O, navigation, highlights, status bar
├── samples/
│   ├── CUSTINQ.rpg                   ← Fixed-format RPG IV test file
│   └── INVPROC.rpgle                 ← Free-format RPGLE test file
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [VS Code](https://code.visualstudio.com/) v1.85+

### Install & Run

```bash
# 1. Install dependencies (no API keys needed — pure static analysis)
npm install

# 2. Compile TypeScript
npm run compile

# 3. Press F5 in VS Code to launch the Extension Development Host
```

That's it. No API keys. No internet connection required.

---

## 🖱️ Usage

### Analyze a File
1. Open any `.rpgle` or `.rpg` file
2. Right-click → **"Analyze RPG Program"**  
   — or — press `Ctrl+Shift+P` → **RPGenius: Analyze RPG Program**
3. The **RPGenius Analyzer** sidebar panel opens with the full program map

### Analyze the Whole Workspace
- Command Palette → **RPGenius: Analyze Entire Workspace**
- Scans all `.rpgle` / `.rpg` files and caches results

### Navigate to Source
- Click any item in the tree (a file, procedure, SQL statement, etc.)
- VS Code jumps to the exact source line and briefly highlights it

### Auto-Analyze
- Extension **auto-analyzes** when you open a recognized RPGLE file
- Extension **re-analyzes** after every save

---

## 🌳 Tree View Structure

```
📄 INVPROC  [FREE] · 120 lines
├── 📚 Files (5)
│   ├── INVHDR      [U / DISK · Keyed]
│   ├── INVDET      [I / DISK]
│   ├── CUSTMST     [I / DISK]
│   ├── INVOUT      [O / PRINTER]
│   └── INVWRK      [I/O / WORKSTN]
├── 📋 Copybooks (3)
│   ├── QRPGLESRC/INVCPY
│   ├── QRPGLESRC/SQLCA
│   └── COMMONLIB/ERRSUB
├── 📞 Programs Called (3)
│   ├── TAXCALC     [CALLP]
│   ├── GLPOST      [CALLP]
│   └── PostSummaryReport [CALLP]
├── ⚙️  Procedures (3)
│   ├── ValidateAndLoad    → IND · (1 params)
│   ├── PostSummaryReport  → (2 params)
│   └── CalcTaxBreakdown   EXPORT · (3 params)
├── 🗂️  Data Structures (4)
│   ├── InvKey      [Qualified · 2 subfields]
│   ├── CustInfo    [LikeDS · template]
│   ├── TaxBreakdown [Qualified · 4 subfields]
│   └── SqlHostVars [DS · 4 subfields]
├── 🗄️  SQL Statements (6)
│   ├── DECLARE #1  DECLARE InvCursor CURSOR...
│   ├── SELECT  #2  OPEN InvCursor
│   ├── SELECT  #3  FETCH NEXT FROM InvCursor...
│   ├── UPDATE  #4  UPDATE INVHDR SET INV_STATUS...
│   ├── UPDATE  #5  UPDATE INVHDR SET INV_STATUS...
│   └── SELECT  #6  FETCH NEXT FROM InvCursor...
├── 🔄 Cursors (1)
│   └── InvCursor   SELECT INV_NO, CUST_NO...
├── 🔤 Variables (7)
│   ├── WsInvTotal  PACKED(13:2)
│   └── ...
└── 🔌 Prototypes (3)
    ├── CalcTax     ExtPgm(TAXCALC)
    └── ...
```

---

## 🏗️ Architecture

### Parser (`rpgleParser.ts`)
A streaming line-by-line state machine. Maintains parser state including:
- `isFreeFormat` — detects `**FREE` directive
- `inInlineFree` — tracks `/FREE.../END-FREE` blocks
- `inSqlBlock` — accumulates multi-line `EXEC SQL` statements
- `inProcedure` / `inDS` / `inPrototype` — tracks open blocks for subfields and params

### Regex Rules (`regexRules.ts`)
All 40+ patterns are centralized, named, and documented. Easy to extend with new patterns.

### Dependency Builder (`dependencyBuilder.ts`)
Takes one or more `RpgleProgram` objects and produces:
- `nodes`: map of program → `{calls[], usesFiles[], includesCopybooks[]}`
- `calledBy`: reverse map — which programs call a given program name

### Tree Provider (`treeProvider.ts`)
Implements `vscode.TreeDataProvider<RpgTreeItem>`. Each `RpgTreeItem` carries:
- `sourceLocation` → enables click-to-navigate
- `children` → inline tree, no async fetching needed
- `command` → wired to `rpgenius.navigateToLine`

---

## 🐛 Troubleshooting

| Problem | Solution |
|---|---|
| Extension not loading | Run `npm run compile` first, then F5 |
| File not analyzed automatically | Check extension is `.rpgle` or `.rpg` |
| Wrong line navigation | Report with your source — it may be a mixed-format edge case |
| Fixed-format not parsing | Ensure lines start with the 5-char sequence field in col 1-5 |

---

## 📄 License

MIT — Free to use and modify in enterprise IBM i environments.
# RPGenius_Analyzer
