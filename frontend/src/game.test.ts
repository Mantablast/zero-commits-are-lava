import assert from "node:assert/strict";
import { test } from "node:test";
import { SHALLOW_MAX_STEPS, SOLID_TO_SHALLOW_STEPS, scoreRun, simulateRun, toGameGrid } from "./game";

const formatISODate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getTodayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const makeRawGrid = (cols: number, countFor: (row: number, col: number) => number) => {
  const start = new Date(Date.UTC(2000, 0, 1));
  return Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      row,
      col,
      date: formatISODate(addDays(start, row * cols + col)),
      count: countFor(row, col),
    }))
  );
};

test("toGameGrid maps counts to types and steps", () => {
  const raw = makeRawGrid(3, (_row, col) => {
    if (col === 0) return 0;
    if (col === 1) return 1;
    return 0;
  });
  const grid = toGameGrid(raw);

  assert.equal(grid[0][0].type, "lava");
  assert.equal(grid[0][1].type, "shallow");
  assert.equal(grid[0][1].stepsLeft, SHALLOW_MAX_STEPS);
  assert.equal(grid[0][2].type, "solid");
  assert.equal(grid[0][2].stepsLeft, 0);
});

test("toGameGrid keeps future dates as lava even in the last column", () => {
  const futureStart = addDays(getTodayUTC(), 1);
  const raw = Array.from({ length: 7 }, (_, row) => [
    {
      row,
      col: 0,
      date: formatISODate(addDays(futureStart, row)),
      count: 5,
    },
  ]);
  const grid = toGameGrid(raw);

  assert.equal(grid[0][0].type, "lava");
});

test("simulateRun only moves to adjacent tiles", () => {
  const raw = makeRawGrid(4, () => 4);
  const grid = toGameGrid(raw);
  const result = simulateRun(grid, 3);

  assert.equal(result.win, true);
  assert.equal(result.death, false);
  assert.ok(result.path.length > 1);

  for (let i = 1; i < result.path.length; i += 1) {
    const prev = result.path[i - 1];
    const next = result.path[i];
    const dr = Math.abs(next.row - prev.row);
    const dc = Math.abs(next.col - prev.col);
    assert.ok(dr <= 1, `row delta too large: ${dr}`);
    assert.ok(dc <= 1, `col delta too large: ${dc}`);
    assert.ok(dr + dc > 0, "move must change position");
  }
});

test("simulateRun favors routes with stronger reachability to the goal", () => {
  const raw = makeRawGrid(4, (row, col) => {
    if (row === 3 && col === 0) return 3;
    if (row === 2 && col === 1) return 3;
    if (row === 4 && col === 1) return 1;
    if (row === 4 && col === 2) return 3;
    if (row === 4 && col === 3) return 3;
    return 0;
  });
  const grid = toGameGrid(raw);
  const result = simulateRun(grid, 3);

  assert.ok(result.path.length > 1);
  assert.deepEqual(result.path[1], { row: 4, col: 1 });
  assert.equal(result.win, true);
});

test("simulateRun lets the avatar leave a collapsing shallow tile once", () => {
  const raw = makeRawGrid(2, (_row, col) => (col === 0 ? 1 : 3));
  const grid = toGameGrid(raw);
  grid[0][0].stepsLeft = 1;

  const result = simulateRun(grid, 0);

  assert.equal(result.death, false);
  assert.equal(result.win, true);
  assert.ok(result.path.length >= 2);
  assert.equal(result.grid[0][0].type, "lava");
});

test("solid tiles become shallow after two visits and then decay", () => {
  const raw = makeRawGrid(4, (row, col) => {
    if (row === 0 && (col === 0 || col === 1)) return 3;
    return 0;
  });
  const grid = toGameGrid(raw);

  const result = simulateRun(grid, 0);
  const tile = result.grid[0][0];

  assert.equal(tile.visits >= SOLID_TO_SHALLOW_STEPS, true);
  assert.equal(tile.type, "shallow");
  assert.equal(tile.stepsLeft, SHALLOW_MAX_STEPS - 1);
});

test("simulateRun backtracks when it hits a dead end", () => {
  const raw = makeRawGrid(4, (row, col) => {
    if (row === 0 && (col === 0 || col === 1)) return 3;
    return 0;
  });
  const grid = toGameGrid(raw);
  const result = simulateRun(grid, 0);

  assert.equal(result.win, false);
  assert.equal(result.death, true);
  assert.equal(result.path.length, 3);
  assert.deepEqual(result.path[0], result.path[2]);
});

test("simulateRun limits backtracking to three columns behind the furthest reach", () => {
  const raw = makeRawGrid(8, (row, col) => {
    if (row === 0 && col <= 5) return 3;
    return 0;
  });
  const grid = toGameGrid(raw);
  const result = simulateRun(grid, 0);

  const maxCol = Math.max(...result.path.map((step) => step.col));
  const firstMaxIndex = result.path.findIndex((step) => step.col === maxCol);
  const minAfterMax = Math.min(...result.path.slice(firstMaxIndex).map((step) => step.col));
  assert.equal(minAfterMax >= maxCol - 3, true);
});

test("simulateRun can carry decay across attempts when cloning is disabled", () => {
  const raw = makeRawGrid(2, (row, col) => {
    if (row === 0 && col === 0) return 1;
    if (row === 0 && col === 1) return 3;
    return 0;
  });
  const grid = toGameGrid(raw);
  const first = simulateRun(grid, 0, { clone: false });
  assert.equal(first.death, false);

  const second = simulateRun(grid, 0, { clone: false });
  assert.equal(second.death, true);
});

test("scoreRun uses the documented formula", () => {
  const raw = makeRawGrid(5, () => 3);
  const grid = toGameGrid(raw);
  const result = {
    path: [{ row: 0, col: 0 }],
    win: true,
    death: false,
    reachedColumns: 5,
    grid,
  };
  const score = scoreRun(5, result);

  assert.equal(score.breakdown.base, 500);
  assert.equal(score.breakdown.progress, 1000);
  assert.equal(score.breakdown.winBonus, 500);
  assert.equal(score.breakdown.deathPenalty, 0);
  assert.equal(score.breakdown.jumpBonus, 0);
  assert.equal(score.breakdown.hardModeBonus, 0);
  assert.equal(score.total, 2000);
});

test("scoreRun adds jump bonuses per move", () => {
  const raw = makeRawGrid(3, () => 3);
  const grid = toGameGrid(raw);
  const result = {
    path: [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ],
    win: true,
    death: false,
    reachedColumns: 3,
    grid,
  };
  const score = scoreRun(3, result);

  assert.equal(score.breakdown.jumpBonus, 10);
  assert.equal(score.total, score.breakdown.base + score.breakdown.progress + score.breakdown.winBonus + score.breakdown.deathPenalty + score.breakdown.jumpBonus + score.breakdown.hardModeBonus);
});
