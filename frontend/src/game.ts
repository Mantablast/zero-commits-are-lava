export type TileType = "lava" | "shallow" | "solid";

export type Tile = {
  row: number;
  col: number;
  date: string;
  count: number;
  type: TileType;
  stepsLeft: number;
  visits: number;
};

export type RawTile = {
  row: number;
  col: number;
  date: string;
  count: number;
};

export type RunResult = {
  path: Array<{ row: number; col: number }>;
  win: boolean;
  death: boolean;
  reachedColumns: number;
  grid: Tile[][];
  frames?: Tile[][][];
  deathIndex?: number;
  skipped?: boolean;
};

export type ScoreBreakdown = {
  base: number;
  progress: number;
  winBonus: number;
  deathPenalty: number;
  jumpBonus: number;
  hardModeBonus: number;
};

export type AttemptScore = {
  total: number;
  breakdown: ScoreBreakdown;
  attempt: number;
  startWeek: string;
  win: boolean;
  reachedColumns: number;
  death: boolean;
  skipped?: boolean;
};

export const SHALLOW_MAX_STEPS = 2;
export const SOLID_TO_SHALLOW_STEPS = 2;

export const toGameGrid = (rawGrid: RawTile[][]) => {
  const lastCol = rawGrid[0].length - 1;
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return rawGrid.map((row) =>
    row.map((tile) => {
      const tileDate = new Date(`${tile.date}T00:00:00Z`);
      const isFuture = tileDate > todayUTC;
      let type: TileType = "lava";
      if (!isFuture) {
        if (tile.count >= 3) type = "solid";
        else if (tile.count >= 1) type = "shallow";
        if (tile.col === lastCol) type = "solid";
      }
      const stepsLeft = type === "shallow" ? SHALLOW_MAX_STEPS : 0;
      return {
        ...tile,
        type,
        stepsLeft,
        visits: 0,
      };
    })
  );
};

const cloneGrid = (grid: Tile[][]) => {
  return grid.map((row) => row.map((tile) => ({ ...tile })));
};

export const simulateRun = (
  grid: Tile[][],
  startRow: number,
  options: { clone?: boolean } = {}
): RunResult => {
  const mutable = options.clone === false ? grid : cloneGrid(grid);
  const frames: Tile[][][] = [];
  const startTile = mutable[startRow]?.[0];
  if (!startTile || startTile.type === "lava") {
    return {
      path: [],
      win: false,
      death: false,
      reachedColumns: 0,
      grid: mutable,
      frames,
      skipped: true,
    };
  }

  const keyFor = (tile: Tile) => `${tile.row}:${tile.col}`;
  const maxBacktrack = 3;

  const estimateReach = (from: Tile) => {
    const queue: Array<{ tile: Tile; steps: number }> = [{ tile: from, steps: 0 }];
    const seen = new Set<string>([keyFor(from)]);
    let maxReachCol = from.col;
    let stepsToGoal = Number.POSITIVE_INFINITY;

    while (queue.length > 0) {
      const currentNode = queue.shift();
      if (!currentNode) break;
      const { tile, steps } = currentNode;
      if (tile.col > maxReachCol) maxReachCol = tile.col;
      if (tile.col === maxCol && steps < stepsToGoal) stepsToGoal = steps;

      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const nextRow = tile.row + dr;
          const nextCol = tile.col + dc;
          if (nextRow < 0 || nextRow > 6) continue;
          if (nextCol < 0 || nextCol > maxCol) continue;
          if (nextCol < reached - maxBacktrack) continue;
          const nextTile = mutable[nextRow][nextCol];
          if (!nextTile || nextTile.type === "lava") continue;
          if (nextTile.type === "shallow" && nextTile.stepsLeft <= 0) continue;
          const nextKey = keyFor(nextTile);
          if (inPath.has(nextKey)) continue;
          if (seen.has(nextKey)) continue;
          seen.add(nextKey);
          queue.push({ tile: nextTile, steps: steps + 1 });
        }
      }
    }

    return { maxReachCol, stepsToGoal };
  };

  const scoreTile = (
    tile: Tile,
    visitedCount: number,
    colDelta: number,
    reach: { maxReachCol: number; stepsToGoal: number }
  ) => {
    const typeScore = tile.type === "solid" ? 4 : tile.type === "shallow" ? 1 : -10;
    const forwardBias = colDelta * 6;
    const canReachGoal = Number.isFinite(reach.stepsToGoal);
    const reachScore = reach.maxReachCol * 12 + (canReachGoal ? 120 - reach.stepsToGoal : 0);
    return tile.col * 10 + typeScore + forwardBias - visitedCount * 2 + reachScore;
  };

  const visited = new Map<string, number>();
  const path: Array<{ row: number; col: number }> = [];
  let current = startTile;

  const remember = (tile: Tile) => {
    const key = `${tile.row}:${tile.col}`;
    visited.set(key, (visited.get(key) || 0) + 1);
  };

  const stepOnTile = (tile: Tile) => {
    tile.visits += 1;
    if (tile.type === "shallow") {
      tile.stepsLeft -= 1;
      if (tile.stepsLeft <= 0) {
        tile.type = "lava";
        tile.stepsLeft = 0;
        return false;
      }
    } else if (tile.type === "solid") {
      if (tile.visits >= SOLID_TO_SHALLOW_STEPS) {
        tile.type = "shallow";
        tile.stepsLeft = SHALLOW_MAX_STEPS - 1;
        if (tile.stepsLeft <= 0) {
          tile.type = "lava";
          tile.stepsLeft = 0;
          return false;
        }
      }
    }
    return tile.type === "lava";
  };

  remember(current);
  const startDeath = stepOnTile(current);
  path.push({ row: current.row, col: current.col });
  frames.push(cloneGrid(mutable));
  if (startDeath) {
    return {
      path,
      win: false,
      death: true,
      reachedColumns: current.col + 1,
      grid: mutable,
      frames,
      deathIndex: path.length - 1,
    };
  }

  const maxCol = mutable[0].length - 1;
  let reached = current.col;
  const maxMoves = Math.max(30, maxCol * 10);
  const stack: Tile[] = [current];
  const inPath = new Set<string>([keyFor(current)]);
  const triedFrom = new Map<string, Set<string>>();

  const markTried = (from: Tile, to: Tile) => {
    const fromKey = keyFor(from);
    const toKey = keyFor(to);
    const set = triedFrom.get(fromKey) ?? new Set<string>();
    set.add(toKey);
    triedFrom.set(fromKey, set);
  };

  const wasTried = (from: Tile, to: Tile) => {
    return triedFrom.get(keyFor(from))?.has(keyFor(to)) ?? false;
  };

  const collectCandidates = (from: Tile) => {
    const candidates: Tile[] = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nextRow = from.row + dr;
        const nextCol = from.col + dc;
        if (nextRow < 0 || nextRow > 6) continue;
        if (nextCol < 0 || nextCol > maxCol) continue;
        if (nextCol < reached - maxBacktrack) continue;
        const nextTile = mutable[nextRow][nextCol];
        if (!nextTile || nextTile.type === "lava") continue;
        if (nextTile.type === "shallow" && nextTile.stepsLeft <= 0) continue;
        if (inPath.has(keyFor(nextTile))) continue;
        if (wasTried(from, nextTile)) continue;
        candidates.push(nextTile);
      }
    }
    return candidates;
  };

  while (path.length < maxMoves) {
    if (current.col === maxCol) {
      return {
        path,
        win: true,
        death: false,
        reachedColumns: reached + 1,
        grid: mutable,
        frames,
      };
    }

    const candidates = collectCandidates(current);
    if (candidates.length === 0) {
      if (stack.length === 1) {
        return {
          path,
          win: false,
          death: true,
          reachedColumns: reached + 1,
          grid: mutable,
          frames,
          deathIndex: path.length - 1,
        };
      }

      const backtrackTarget = stack[stack.length - 2];
      if (backtrackTarget.col < reached - maxBacktrack) {
        return {
          path,
          win: false,
          death: true,
          reachedColumns: reached + 1,
          grid: mutable,
          frames,
          deathIndex: path.length - 1,
        };
      }

      const deadEnd = stack.pop();
      if (deadEnd) {
        inPath.delete(keyFor(deadEnd));
      }
      current = backtrackTarget;
      remember(current);
      const diedHere = stepOnTile(current);
      path.push({ row: current.row, col: current.col });
      frames.push(cloneGrid(mutable));
      if (current.col > reached) reached = current.col;
      if (diedHere) {
        return {
          path,
          win: false,
          death: true,
          reachedColumns: reached + 1,
          grid: mutable,
          frames,
          deathIndex: path.length - 1,
        };
      }
      continue;
    }

    const reachCache = new Map<string, { maxReachCol: number; stepsToGoal: number }>();
    const getReach = (tile: Tile) => {
      const key = keyFor(tile);
      const cached = reachCache.get(key);
      if (cached) return cached;
      const computed = estimateReach(tile);
      reachCache.set(key, computed);
      return computed;
    };

    candidates.sort((a, b) => {
      const aReach = getReach(a);
      const bReach = getReach(b);
      const aGoal = Number.isFinite(aReach.stepsToGoal);
      const bGoal = Number.isFinite(bReach.stepsToGoal);
      if (aGoal !== bGoal) return aGoal ? -1 : 1;
      if (bReach.maxReachCol !== aReach.maxReachCol) return bReach.maxReachCol - aReach.maxReachCol;
      const aScore = scoreTile(a, visited.get(`${a.row}:${a.col}`) || 0, a.col - current.col, aReach);
      const bScore = scoreTile(b, visited.get(`${b.row}:${b.col}`) || 0, b.col - current.col, bReach);
      if (bScore !== aScore) return bScore - aScore;
      return b.count - a.count;
    });

    const next = candidates[0];
    markTried(current, next);
    current = next;
    stack.push(current);
    inPath.add(keyFor(current));
    remember(current);
    const diedHere = stepOnTile(current);
    path.push({ row: current.row, col: current.col });
    frames.push(cloneGrid(mutable));
    if (current.col > reached) reached = current.col;

    if (diedHere) {
      return {
        path,
        win: false,
        death: true,
        reachedColumns: reached + 1,
        grid: mutable,
        frames,
        deathIndex: path.length - 1,
      };
    }
  }

  return {
    path,
    win: false,
    death: true,
    reachedColumns: reached + 1,
    grid: mutable,
    frames,
    deathIndex: path.length - 1,
  };
};

export const scoreRun = (weeks: number, result: RunResult, options: { hardModeBonus?: number } = {}) => {
  const base = weeks * 100;
  const progress = Math.round((result.reachedColumns / weeks) * 1000);
  const winBonus = result.win ? 500 : 0;
  const deathPenalty = result.death ? -200 : 0;
  const jumps = Math.max(0, result.path.length - 1);
  const jumpBonus = jumps * 5;
  const hardModeBonus = options.hardModeBonus ?? 0;
  const breakdown: ScoreBreakdown = { base, progress, winBonus, deathPenalty, jumpBonus, hardModeBonus };
  return {
    total: base + progress + winBonus + deathPenalty + jumpBonus + hardModeBonus,
    breakdown,
  };
};
