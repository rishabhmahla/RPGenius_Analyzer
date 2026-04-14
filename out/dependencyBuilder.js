"use strict";
/**
 * dependencyBuilder.ts
 * Builds a dependency graph from one or more parsed RpgleProgram objects.
 *
 * Relationships tracked:
 *   - Program → Programs it calls
 *   - Program → Files it uses
 *   - Program → Copybooks it includes
 *   - Reverse map: which programs call a given program
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDependencyGraph = buildDependencyGraph;
exports.buildDependencyGraphFromMany = buildDependencyGraphFromMany;
exports.summarizeDependencies = summarizeDependencies;
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Builds a DependencyGraph from a single parsed program.
 */
function buildDependencyGraph(program) {
    return buildDependencyGraphFromMany([program]);
}
/**
 * Builds a DependencyGraph from multiple parsed programs (workspace analysis).
 * Cross-references CALL targets across programs.
 */
function buildDependencyGraphFromMany(programs) {
    const nodes = new Map();
    const calledBy = new Map();
    for (const program of programs) {
        const node = {
            programName: program.programName,
            filePath: program.filePath,
            calls: dedupeNames(program.programCalls.map(c => c.programName.toUpperCase())),
            usesFiles: dedupeNames(program.files.map(f => {
                if (f.resolvedObject?.library) {
                    return `${f.resolvedObject.library.toUpperCase()}/${f.name.toUpperCase()}`;
                }
                return f.name.toUpperCase();
            })),
            includesCopybooks: dedupeNames(program.copybooks.map(c => c.library ? `${c.library}/${c.member}` : c.member)),
        };
        nodes.set(program.programName.toUpperCase(), node);
    }
    // Build reverse map: "who calls X?"
    for (const [callerName, node] of nodes.entries()) {
        for (const callee of node.calls) {
            const existing = calledBy.get(callee) ?? [];
            if (!existing.includes(callerName)) {
                existing.push(callerName);
            }
            calledBy.set(callee, existing);
        }
    }
    return { nodes, calledBy };
}
/**
 * Returns a human-readable summary of a dependency node.
 */
function summarizeDependencies(node) {
    const lines = [
        `Program: ${node.programName}`,
        `  Calls (${node.calls.length}): ${node.calls.join(', ') || 'none'}`,
        `  Files (${node.usesFiles.length}): ${node.usesFiles.join(', ') || 'none'}`,
        `  Copybooks (${node.includesCopybooks.length}): ${node.includesCopybooks.join(', ') || 'none'}`,
    ];
    return lines.join('\n');
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function dedupeNames(names) {
    return [...new Set(names.filter(n => n.trim() !== ''))];
}
//# sourceMappingURL=dependencyBuilder.js.map