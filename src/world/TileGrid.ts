/**
 * Turns a map's ASCII rows into tile layers and a walkability grid, and does
 * the pathfinding for tap-to-move.
 *
 * Maps are authored as character rows plus a legend so a new room is a
 * readable block of text in a JSON file, not a hand-written array of indices.
 */

import type { MapData } from '@/types/schema';

export interface Point {
  x: number;
  y: number;
}

export class TileGrid {
  readonly width: number;
  readonly height: number;
  /** Floor tile index per cell. */
  readonly floor: number[][];
  /** Object tile index per cell, or -1 for none. */
  readonly object: number[][];
  private blocked: boolean[][];

  constructor(map: MapData) {
    this.height = map.rows.length;
    this.width = Math.max(...map.rows.map((row) => row.length));

    this.floor = [];
    this.object = [];
    this.blocked = [];

    for (let y = 0; y < this.height; y++) {
      const floorRow: number[] = [];
      const objectRow: number[] = [];
      const blockedRow: boolean[] = [];
      const source = map.rows[y] ?? '';
      for (let x = 0; x < this.width; x++) {
        const symbol = source[x] ?? ' ';
        const entry = map.legend[symbol];
        if (!entry) {
          // Unknown symbols become void rather than throwing, so a typo in a
          // map file shows up as a visible hole instead of a blank screen.
          floorRow.push(0);
          objectRow.push(-1);
          blockedRow.push(true);
          continue;
        }
        floorRow.push(entry.floor);
        objectRow.push(entry.object ?? -1);
        blockedRow.push(entry.collide === true);
      }
      this.floor.push(floorRow);
      this.object.push(objectRow);
      this.blocked.push(blockedRow);
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  walkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.blocked[y]?.[x] !== true;
  }

  /** Mark a cell blocked at runtime — used to keep NPCs solid. */
  setBlocked(x: number, y: number, value: boolean): void {
    if (!this.inBounds(x, y)) return;
    const row = this.blocked[y];
    if (row) row[x] = value;
  }

  /**
   * Breadth-first path in 4 directions. BFS rather than A* because rooms are
   * at most a few hundred tiles and shortest-path-by-steps is exactly what
   * tap-to-move wants; no heuristic tuning, no diagonal corner-cutting.
   */
  findPath(from: Point, to: Point): Point[] {
    if (!this.walkable(to.x, to.y)) return [];
    if (from.x === to.x && from.y === to.y) return [];

    const key = (x: number, y: number) => y * this.width + x;
    const cameFrom = new Map<number, number>();
    const seen = new Set<number>([key(from.x, from.y)]);
    const queue: Point[] = [from];
    const deltas = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift() as Point;
      if (current.x === to.x && current.y === to.y) {
        // Walk the parent chain back to the start.
        const path: Point[] = [];
        let cursor = key(current.x, current.y);
        const startKey = key(from.x, from.y);
        while (cursor !== startKey) {
          path.push({ x: cursor % this.width, y: Math.floor(cursor / this.width) });
          const parent = cameFrom.get(cursor);
          if (parent === undefined) return [];
          cursor = parent;
        }
        return path.reverse();
      }
      for (const delta of deltas) {
        const nx = current.x + delta.x;
        const ny = current.y + delta.y;
        const nk = key(nx, ny);
        if (seen.has(nk) || !this.walkable(nx, ny)) continue;
        seen.add(nk);
        cameFrom.set(nk, key(current.x, current.y));
        queue.push({ x: nx, y: ny });
      }
    }
    return [];
  }

  /**
   * The walkable tile beside `target` that is cheapest to reach from `from`.
   * Used when the player taps a solid thing: you cannot stand in the bookshelf,
   * so stand next to it.
   */
  nearestAdjacent(target: Point, from: Point): Point | undefined {
    if (this.walkable(target.x, target.y)) return target;
    const candidates = [
      { x: target.x, y: target.y + 1 },
      { x: target.x, y: target.y - 1 },
      { x: target.x - 1, y: target.y },
      { x: target.x + 1, y: target.y },
    ].filter((p) => this.walkable(p.x, p.y));
    if (candidates.length === 0) return undefined;

    let best: Point | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate.x === from.x && candidate.y === from.y) return candidate;
      const path = this.findPath(from, candidate);
      // An unreachable candidate returns an empty path; skip it.
      if (path.length === 0) continue;
      if (path.length < bestCost) {
        bestCost = path.length;
        best = candidate;
      }
    }
    return best;
  }

  /** Chebyshev distance, for "are we close enough to interact" checks. */
  static distance(a: Point, b: Point): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
}
