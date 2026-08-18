import { describe, expect, it } from 'vitest';
import {
  FactGraphDomainError,
  deriveMemoryProjection,
  orderFactGraphHistory,
  type FactGraphNode,
  type FactRelationRecord,
} from './fact-graph.js';

const at = (minute: number) => new Date(`2026-08-18T00:${minute.toString().padStart(2, '0')}:00.000Z`);

function nodes(...factIds: string[]): FactGraphNode[] {
  return factIds.map((factId, index) => ({ factId, createdAt: at(index) }));
}

function relation(predecessorFactId: string, successorFactId: string): FactRelationRecord {
  return {
    memoryId: 'memory-1',
    predecessorFactId,
    successorFactId,
    relationType: 'SUPERSEDES',
  };
}

describe('causal fact graph projection', () => {
  it('resolves a linear chain to its only leaf', () => {
    expect(
      deriveMemoryProjection(nodes('A', 'B', 'C'), [relation('A', 'B'), relation('B', 'C')]),
    ).toEqual({ status: 'RESOLVED', currentFactId: 'C' });
  });

  it('preserves concurrent successors as an explicit conflict', () => {
    expect(
      deriveMemoryProjection(nodes('A', 'B', 'C'), [relation('A', 'B'), relation('A', 'C')]),
    ).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['B', 'C'] });
  });

  it('recognizes an explicit multi-predecessor resolution', () => {
    expect(
      deriveMemoryProjection(nodes('A', 'B', 'C', 'D'), [
        relation('A', 'B'),
        relation('A', 'C'),
        relation('B', 'D'),
        relation('C', 'D'),
      ]),
    ).toEqual({ status: 'RESOLVED', currentFactId: 'D' });
  });

  it('allows conflict resolution itself to branch recursively', () => {
    expect(
      deriveMemoryProjection(nodes('A', 'B', 'C', 'D', 'E'), [
        relation('A', 'B'),
        relation('A', 'C'),
        relation('B', 'D'),
        relation('C', 'D'),
        relation('B', 'E'),
        relation('C', 'E'),
      ]),
    ).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['D', 'E'] });
  });

  it('orders history topologically and exposes authoritative predecessor sets', () => {
    const ordered = orderFactGraphHistory(nodes('D', 'B', 'A', 'C'), [
      relation('A', 'C'),
      relation('C', 'D'),
      relation('A', 'B'),
      relation('B', 'D'),
    ]);

    expect(ordered.map((node) => node.factId)).toEqual(['A', 'B', 'C', 'D']);
    expect(ordered.find((node) => node.factId === 'A')?.predecessorFactIds).toEqual([]);
    expect(ordered.find((node) => node.factId === 'D')?.predecessorFactIds).toEqual(['B', 'C']);
  });

  it.each([
    {
      name: 'self edge',
      graphNodes: nodes('A'),
      relations: [relation('A', 'A')],
    },
    {
      name: 'missing endpoint',
      graphNodes: nodes('A'),
      relations: [relation('A', 'B')],
    },
    {
      name: 'cycle',
      graphNodes: nodes('A', 'B'),
      relations: [relation('A', 'B'), relation('B', 'A')],
    },
  ])('fails closed for a broken graph: $name', ({ graphNodes, relations }) => {
    expect(() => deriveMemoryProjection(graphNodes, relations)).toThrow(
      expect.objectContaining<Partial<FactGraphDomainError>>({ code: 'BROKEN_GRAPH' }),
    );
  });
});
