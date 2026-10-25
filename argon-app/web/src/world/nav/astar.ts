// OWNER: mahin
export interface GraphLike {
  neighbors(id: string): readonly { id: string; cost: number }[];
  distance(a: string, b: string): number;
}
/** Deterministic A* with nonnegative Euclidean edge costs; [] means unreachable. */
export function astar(graph: GraphLike, start: string, goal: string): string[] {
  const open = new Set([start]),
    came = new Map<string, string>(),
    costs = new Map([[start, 0]]),
    scores = new Map([[start, graph.distance(start, goal)]]);
  while (open.size) {
    let current = "";
    let best = Infinity;
    for (const id of open) {
      const score = scores.get(id) ?? Infinity;
      if (score < best) {
        current = id;
        best = score;
      }
    }
    if (!current) return [];
    if (current === goal) {
      const out = [current];
      while (came.has(current)) {
        current = came.get(current)!;
        out.unshift(current);
      }
      return out;
    }
    open.delete(current);
    for (const edge of graph.neighbors(current)) {
      const cost = costs.get(current)! + edge.cost;
      if (cost < (costs.get(edge.id) ?? Infinity)) {
        came.set(edge.id, current);
        costs.set(edge.id, cost);
        scores.set(edge.id, cost + graph.distance(edge.id, goal));
        open.add(edge.id);
      }
    }
  }
  return [];
}
export default astar;
