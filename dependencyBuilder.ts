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

import { RpgleProgram, DependencyGraph, DependencyNode } from './models';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a DependencyGraph from a single parsed program.
 */
export function buildDependencyGraph(program: RpgleProgram): DependencyGraph {
  return buildDependencyGraphFromMany([program]);
}

/**
 * Builds a DependencyGraph from multiple parsed programs (workspace analysis).
 * Cross-references CALL targets across programs.
 */
export function buildDependencyGraphFromMany(programs: RpgleProgram[]): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const calledBy = new Map<string, string[]>();

  for (const program of programs) {
    const node: DependencyNode = {
      programName: program.programName,
      filePath: program.filePath,
      calls: dedupeNames(program.programCalls.map(c => c.programName.toUpperCase())),
      usesFiles: dedupeNames(program.files.map(f => f.name.toUpperCase())),
      includesCopybooks: dedupeNames(
        program.copybooks.map(c => c.library ? `${c.library}/${c.member}` : c.member)
      ),
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
export function summarizeDependencies(node: DependencyNode): string {
  const lines: string[] = [
    `Program: ${node.programName}`,
    `  Calls (${node.calls.length}): ${node.calls.join(', ') || 'none'}`,
    `  Files (${node.usesFiles.length}): ${node.usesFiles.join(', ') || 'none'}`,
    `  Copybooks (${node.includesCopybooks.length}): ${node.includesCopybooks.join(', ') || 'none'}`,
  ];
  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupeNames(names: string[]): string[] {
  return [...new Set(names.filter(n => n.trim() !== ''))];
}
