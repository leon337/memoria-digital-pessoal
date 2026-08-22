export interface FactGraphNode {
  factId: string;
  createdAt: Date;
}

export interface FactRelationRecord {
  memoryId: string;
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}

export type DerivedMemoryProjection =
  | { status: 'RESOLVED'; currentFactId: string }
  | { status: 'CONFLICT'; baselineFactId: string; candidateFactIds: string[] };

export interface OrderedFactGraphNode extends FactGraphNode {
  predecessorFactIds: string[];
}

export type FactGraphDomainErrorCode = 'BROKEN_GRAPH';

export class FactGraphDomainError extends Error {
  readonly code: FactGraphDomainErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'FactGraphDomainError';
    this.code = 'BROKEN_GRAPH';
  }
}

interface ValidatedFactGraph {
  readonly nodes: Map<string, FactGraphNode>;
  readonly predecessors: Map<string, string[]>;
  readonly successors: Map<string, string[]>;
  readonly topologicalOrder: string[];
  readonly depth: Map<string, number>;
}

function brokenGraph(message: string): never {
  throw new FactGraphDomainError(message);
}

function compareNodes(left: FactGraphNode, right: FactGraphNode): number {
  const time = left.createdAt.getTime() - right.createdAt.getTime();
  return time !== 0 ? time : left.factId.localeCompare(right.factId);
}

function sortIds(ids: Iterable<string>, nodes: Map<string, FactGraphNode>): string[] {
  return [...ids].sort((left, right) => compareNodes(nodes.get(left)!, nodes.get(right)!));
}

function buildAndValidateGraph(
  graphNodes: FactGraphNode[],
  relations: FactRelationRecord[],
): ValidatedFactGraph {
  if (graphNodes.length === 0) brokenGraph('fact graph must contain at least one node');

  const nodes = new Map<string, FactGraphNode>();
  for (const node of graphNodes) {
    if (!node.factId || nodes.has(node.factId))
      brokenGraph('fact graph contains an invalid fact id');
    if (Number.isNaN(node.createdAt.getTime()))
      brokenGraph('fact graph contains an invalid timestamp');
    nodes.set(node.factId, node);
  }

  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const factId of nodes.keys()) {
    predecessors.set(factId, []);
    successors.set(factId, []);
  }

  const seenRelations = new Set<string>();
  for (const relation of relations) {
    const { predecessorFactId, successorFactId } = relation;
    if (predecessorFactId === successorFactId) brokenGraph('fact graph contains a self edge');
    if (!nodes.has(predecessorFactId) || !nodes.has(successorFactId)) {
      brokenGraph('fact graph relation references a missing endpoint');
    }
    const key = `${predecessorFactId}\u0000${successorFactId}`;
    if (seenRelations.has(key)) brokenGraph('fact graph contains a duplicate relation');
    seenRelations.add(key);
    predecessors.get(successorFactId)!.push(predecessorFactId);
    successors.get(predecessorFactId)!.push(successorFactId);
  }

  for (const factId of nodes.keys()) {
    predecessors.set(factId, sortIds(predecessors.get(factId)!, nodes));
    successors.set(factId, sortIds(successors.get(factId)!, nodes));
  }

  const indegree = new Map<string, number>();
  for (const [factId, incoming] of predecessors) indegree.set(factId, incoming.length);

  const ready = sortIds(
    [...nodes.keys()].filter((factId) => indegree.get(factId) === 0),
    nodes,
  );
  const topologicalOrder: string[] = [];
  while (ready.length > 0) {
    const factId = ready.shift()!;
    topologicalOrder.push(factId);
    for (const successor of successors.get(factId)!) {
      const remaining = indegree.get(successor)! - 1;
      indegree.set(successor, remaining);
      if (remaining === 0) {
        ready.push(successor);
        ready.sort((left, right) => compareNodes(nodes.get(left)!, nodes.get(right)!));
      }
    }
  }

  if (topologicalOrder.length !== nodes.size) brokenGraph('fact graph contains a cycle');

  const depth = new Map<string, number>();
  for (const factId of topologicalOrder) {
    const incoming = predecessors.get(factId)!;
    depth.set(
      factId,
      incoming.length === 0 ? 0 : Math.max(...incoming.map((id) => depth.get(id)!)) + 1,
    );
  }

  return { nodes, predecessors, successors, topologicalOrder, depth };
}

function intersection(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set<string>();
  const [first, ...rest] = sets;
  return new Set([...first!].filter((value) => rest.every((set) => set.has(value))));
}

export function deriveMemoryProjection(
  graphNodes: FactGraphNode[],
  relations: FactRelationRecord[],
): DerivedMemoryProjection {
  const graph = buildAndValidateGraph(graphNodes, relations);
  const leaves = sortIds(
    [...graph.nodes.keys()].filter((factId) => graph.successors.get(factId)!.length === 0),
    graph.nodes,
  );

  if (leaves.length === 1) return { status: 'RESOLVED', currentFactId: leaves[0]! };

  const dominators = new Map<string, Set<string>>();
  for (const factId of graph.topologicalOrder) {
    const incoming = graph.predecessors.get(factId)!;
    if (incoming.length === 0) {
      dominators.set(factId, new Set([factId]));
      continue;
    }
    const common = intersection(incoming.map((id) => dominators.get(id)!));
    common.add(factId);
    dominators.set(factId, common);
  }

  const commonDominators = intersection(leaves.map((leaf) => dominators.get(leaf)!));
  if (commonDominators.size === 0) brokenGraph('conflicted fact graph has no common baseline');

  const baselineFactId = [...commonDominators].sort((left, right) => {
    const depthDelta = graph.depth.get(right)! - graph.depth.get(left)!;
    return depthDelta !== 0 ? depthDelta : left.localeCompare(right);
  })[0]!;

  return { status: 'CONFLICT', baselineFactId, candidateFactIds: leaves };
}

export function orderFactGraphHistory(
  graphNodes: FactGraphNode[],
  relations: FactRelationRecord[],
): OrderedFactGraphNode[] {
  const graph = buildAndValidateGraph(graphNodes, relations);
  return graph.topologicalOrder.map((factId) => ({
    ...graph.nodes.get(factId)!,
    predecessorFactIds: [...graph.predecessors.get(factId)!].sort(),
  }));
}
