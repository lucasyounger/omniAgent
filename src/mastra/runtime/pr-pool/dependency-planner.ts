import type { PRItem } from './pr-pool-store';

export type DispatchPlan = {
  groups: PRItem[][];
  conflicts: Conflict[];
  cycles: string[][];
  skipped: string[];
};

export type Conflict = {
  itemA: string;
  itemB: string;
  type: 'file' | 'module';
  details: string[];
};

export function buildDispatchPlan(candidates: PRItem[], running: PRItem[], policy: { maxConcurrent: number; maxConcurrentPerRepo: number }): DispatchPlan {
  const conflicts = detectScopeConflicts([...candidates, ...running]);
  const cycles = detectCycles(candidates);
  const cycleIds = new Set(cycles.flat());
  const blockedByRunning = new Set<string>();
  const runningIds = new Set(running.map(item => item.id));
  const runningConflicts = new Set(conflicts.filter(conflict => runningIds.has(conflict.itemA) || runningIds.has(conflict.itemB)).flatMap(conflict => [conflict.itemA, conflict.itemB]));

  for (const item of candidates) {
    if (item.dependencies.some(dependency => runningIds.has(dependency))) {
      blockedByRunning.add(item.id);
    }
  }

  const capacity = Math.max(0, policy.maxConcurrent - running.length);
  const eligible = candidates.filter(item => !cycleIds.has(item.id) && !blockedByRunning.has(item.id) && !runningConflicts.has(item.id));
  const layers = topologicalSort(eligible);
  const groups: PRItem[][] = [];
  const repoCounts = new Map<string, number>();
  const planned = new Set<string>();

  for (const layer of layers) {
    for (const item of layer) {
      if (planned.size >= capacity) break;
      const group = findGroupForItem(groups, item, conflicts, policy.maxConcurrentPerRepo, repoCounts);
      if (!group) continue;
      group.push(item);
      planned.add(item.id);
      repoCounts.set(item.workspace.repoPath, (repoCounts.get(item.workspace.repoPath) || 0) + 1);
    }
  }

  return {
    groups: groups.filter(group => group.length),
    conflicts,
    cycles,
    skipped: candidates.filter(item => !planned.has(item.id)).map(item => item.id),
  };
}

export function detectScopeConflicts(items: PRItem[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const itemA = items[i];
      const itemB = items[j];
      const fileOverlap = overlap(itemA.impact.files || [], itemB.impact.files || []);
      if (fileOverlap.length) {
        conflicts.push({ itemA: itemA.id, itemB: itemB.id, type: 'file', details: fileOverlap });
        continue;
      }
      const moduleOverlap = overlap(itemA.impact.modules, itemB.impact.modules);
      if (moduleOverlap.length) {
        conflicts.push({ itemA: itemA.id, itemB: itemB.id, type: 'module', details: moduleOverlap });
      }
    }
  }
  return conflicts;
}

export function detectCycles(items: PRItem[]): string[][] {
  const itemIds = new Set(items.map(item => item.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (item: PRItem) => {
    if (visiting.has(item.id)) {
      cycles.push(stack.slice(stack.indexOf(item.id)).concat(item.id));
      return;
    }
    if (visited.has(item.id)) return;
    visiting.add(item.id);
    stack.push(item.id);
    for (const dependency of item.dependencies.filter(itemIds.has.bind(itemIds))) {
      const dependencyItem = items.find(candidate => candidate.id === dependency);
      if (dependencyItem) visit(dependencyItem);
    }
    stack.pop();
    visiting.delete(item.id);
    visited.add(item.id);
  };

  for (const item of items) visit(item);
  return cycles;
}

export function topologicalSort(items: PRItem[]): PRItem[][] {
  const remaining = new Map(items.map(item => [item.id, item]));
  const completed = new Set<string>();
  const groups: PRItem[][] = [];

  while (remaining.size) {
    const group = [...remaining.values()].filter(item => item.dependencies.every(dependency => !remaining.has(dependency) || completed.has(dependency)));
    if (!group.length) break;
    groups.push(group);
    for (const item of group) {
      remaining.delete(item.id);
      completed.add(item.id);
    }
  }

  return groups;
}

function findGroupForItem(groups: PRItem[][], item: PRItem, conflicts: Conflict[], maxConcurrentPerRepo: number, repoCounts: Map<string, number>): PRItem[] | undefined {
  if ((repoCounts.get(item.workspace.repoPath) || 0) >= maxConcurrentPerRepo) return undefined;
  if (item.impact.risk === 'high') {
    const group: PRItem[] = [];
    groups.push(group);
    return group;
  }

  const group = groups.find(candidate => candidate.every(existing => existing.impact.risk !== 'high' && !hasConflict(item.id, existing.id, conflicts)));
  if (group) return group;
  const next: PRItem[] = [];
  groups.push(next);
  return next;
}

function hasConflict(itemA: string, itemB: string, conflicts: Conflict[]): boolean {
  return conflicts.some(conflict => (conflict.itemA === itemA && conflict.itemB === itemB) || (conflict.itemA === itemB && conflict.itemB === itemA));
}

function overlap(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter(item => rightSet.has(item));
}
