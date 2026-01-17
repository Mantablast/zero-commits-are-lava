import "./styles.css";
import { SHALLOW_MAX_STEPS, scoreRun, simulateRun, toGameGrid } from "./game";
import type { AttemptScore, RawTile, ScoreBreakdown, Tile } from "./game";

type ContributionDay = { date: string; count: number };

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

const MAX_WEEKS = 52;
const DAYS_PER_WEEK = 7;
const YEAR_OPTION_COUNT = 5;
const PREVIEW_IDLE_MS = 1000;
const PREVIEW_MAX_TILE_SIZE = 26;
const GAME_MAX_TILE_SIZE = 38;
const PREVIEW_LABEL_PAD_X = 56;
const PREVIEW_LABEL_PAD_Y = 28;
const PREVIEW_LABEL_FONT = "12px Space Mono, ui-monospace, monospace";
const BASE_STEP_DURATION = 260;
const HARD_MODE_BONUS = 200;

const parseISODate = (value: string) => new Date(`${value}T00:00:00Z`);

const formatISODate = (date: Date) => date.toISOString().slice(0, 10);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const addDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getTodayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const getWeekStartUTC = (date: Date) => {
  return addDays(date, -date.getUTCDay());
};

const getLatestStartWeek = () => getWeekStartUTC(getTodayUTC());

const getMaxWeeksForStart = (startWeek: string) => {
  const start = parseISODate(startWeek);
  const today = getTodayUTC();
  const diffDays = Math.floor((today.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return Math.max(0, Math.min(MAX_WEEKS, Math.floor(diffDays / DAYS_PER_WEEK)));
};

const buildRange = (startWeek: string, weeks: number) => {
  const start = parseISODate(startWeek);
  const end = addDays(start, weeks * DAYS_PER_WEEK - 1);
  return { from: formatISODate(start), to: formatISODate(end) };
};

const getYearRange = (year: number) => {
  const displayFrom = new Date(Date.UTC(year, 0, 1));
  const start = getWeekStartUTC(displayFrom);
  const today = getTodayUTC();
  const end = year === today.getUTCFullYear() ? today : new Date(Date.UTC(year, 11, 31));
  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  const fullWeeks = Math.floor(days / DAYS_PER_WEEK);
  const weeks = year === today.getUTCFullYear()
    ? Math.min(MAX_WEEKS, fullWeeks)
    : Math.min(MAX_WEEKS, Math.ceil(days / DAYS_PER_WEEK));
  return { start, end, weeks, displayFrom };
};

const buildPreviewRange = (year: number) => {
  const { start, end, weeks, displayFrom } = getYearRange(year);
  const startWeek = formatISODate(start);
  const range = buildRange(startWeek, weeks);
  return {
    ...range,
    startWeek,
    weeks,
    year,
    displayFrom: formatISODate(displayFrom),
    displayTo: formatISODate(end),
  };
};

const listDateRange = (from: string, to: string) => {
  const dates: string[] = [];
  let cursor = parseISODate(from);
  const end = parseISODate(to);
  while (cursor <= end) {
    dates.push(formatISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};

const diffWeeks = (from: Date, to: Date) => {
  const diffDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7);
};

const fetchContrib = async (params: {
  provider: string;
  username: string;
  from: string;
  to: string;
  gitlabHost?: string;
}) => {
  const url = new URL(`${API_BASE}/api/contrib`);
  url.searchParams.set("provider", params.provider);
  url.searchParams.set("username", params.username);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);
  if (params.gitlabHost) {
    url.searchParams.set("gitlabHost", params.gitlabHost);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load contributions.");
  }
  return (await response.json()) as { days: ContributionDay[] };
};

const fetchContribWithFallback = async (params: {
  provider: string;
  username: string;
  from: string;
  to: string;
  gitlabHost: string;
}) => {
  try {
    const data = await fetchContrib(params);
    if (params.provider === "github" && data.days.length === 0) {
      throw new Error("No GitHub data returned.");
    }
    return { data, provider: params.provider, usedFallback: false };
  } catch (error) {
    if (params.provider !== "github") {
      throw error;
    }
    const fallbackParams = { ...params, provider: "gitlab" };
    const data = await fetchContrib(fallbackParams);
    if (data.days.length === 0) {
      throw error;
    }
    return { data, provider: "gitlab", usedFallback: true };
  }
};

const buildRawGrid = (days: ContributionDay[], startWeek: string, weeks: number) => {
  const map = new Map(days.map((day) => [day.date, day.count]));
  const { from, to } = buildRange(startWeek, weeks);
  const dates = listDateRange(from, to);
  const grid: RawTile[][] = Array.from({ length: 7 }, () => []);

  dates.forEach((date, index) => {
    const col = Math.floor(index / 7);
    const row = parseISODate(date).getUTCDay();
    const count = map.get(date) ?? 0;
    grid[row][col] = {
      row,
      col,
      date,
      count,
    };
  });

  return grid;
};

const getGridLayout = (
  canvas: HTMLCanvasElement,
  cols: number,
  padding: { left?: number; right?: number; top?: number; bottom?: number } = {},
  maxTileSize = PREVIEW_MAX_TILE_SIZE
) => {
  const padLeft = padding.left ?? 0;
  const padRight = padding.right ?? 0;
  const padTop = padding.top ?? 0;
  const padBottom = padding.bottom ?? 0;
  const availableWidth = canvas.width - padLeft - padRight;
  const availableHeight = canvas.height - padTop - padBottom;
  let tileSize = Math.min(maxTileSize, Math.floor(Math.min(availableWidth / cols, availableHeight / 7)));
  let gap = Math.max(1, Math.floor(tileSize * 0.15));
  while (tileSize > 2) {
    const totalWidth = cols * tileSize + (cols - 1) * gap;
    const totalHeight = 7 * tileSize + (7 - 1) * gap;
    if (totalWidth <= availableWidth && totalHeight <= availableHeight) break;
    tileSize -= 1;
    gap = Math.max(1, Math.floor(tileSize * 0.15));
  }
  const offsetX = Math.floor(padLeft + (availableWidth - cols * (tileSize + gap)) / 2);
  const offsetY = Math.floor(padTop + (availableHeight - 7 * (tileSize + gap)) / 2);
  return { tileSize, gap, offsetX, offsetY };
};

const renderPreview = (
  canvas: HTMLCanvasElement,
  grid: RawTile[][],
  previewMeta: {
    startWeek: string;
    weeks: number;
    from: string;
    to: string;
    year: number;
    displayFrom: string;
    displayTo: string;
  },
  selection: { startCol: number; endCol: number } | null,
  visibleCols?: number
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cols = Math.min(grid[0].length, visibleCols ?? grid[0].length);
  const { tileSize, gap, offsetX, offsetY } = getGridLayout(
    canvas,
    cols,
    {
      left: PREVIEW_LABEL_PAD_X,
      right: 16,
      top: PREVIEW_LABEL_PAD_Y,
      bottom: 18,
    },
    PREVIEW_MAX_TILE_SIZE
  );
  const colorForCount = (count: number) => {
    if (count === 0) return "#2f2a26";
    if (count <= 2) return "#9be9a8";
    if (count <= 4) return "#40c463";
    if (count <= 9) return "#30a14e";
    return "#216e39";
  };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f0e6db";
  ctx.font = PREVIEW_LABEL_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const previewStart = parseISODate(previewMeta.from);
  for (let col = 0; col < cols; col += 1) {
    const weekStart = addDays(previewStart, col * 7);
    if (weekStart.getUTCDate() <= 7) {
      const label = weekStart.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      const x = offsetX + col * (tileSize + gap);
      ctx.fillText(label, x, offsetY - 12);
    }
  }

  const dayLabels = [
    { label: "Mon", row: 1 },
    { label: "Wed", row: 3 },
    { label: "Fri", row: 5 },
  ];
  dayLabels.forEach(({ label, row }) => {
    const y = offsetY + row * (tileSize + gap) + tileSize / 2;
    ctx.fillText(label, offsetX - 48, y);
  });

  grid.forEach((row) =>
    row.forEach((tile) => {
      if (tile.col >= cols) return;
      const x = offsetX + tile.col * (tileSize + gap);
      const y = offsetY + tile.row * (tileSize + gap);
      ctx.fillStyle = colorForCount(tile.count);
      ctx.fillRect(x, y, tileSize, tileSize);
    })
  );

  if (selection && selection.endCol >= selection.startCol) {
    const startCol = Math.max(0, selection.startCol);
    const endCol = Math.min(cols - 1, selection.endCol);
    if (endCol >= startCol) {
      const x = offsetX + startCol * (tileSize + gap) - 3;
      const y = offsetY - 3;
      const width = (endCol - startCol + 1) * (tileSize + gap) - gap + 6;
      const height = 7 * (tileSize + gap) - gap + 6;
      ctx.strokeStyle = "#ff6f3c";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
    }
  }
};

const drawPixelAvatar = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  const pixel = Math.max(2, Math.floor(size / 8));
  const sprite = [
    "110000011",
    "111111111",
    "111111111",
    "111111111",
    "111111111",
    "011111110",
    "001111100",
    "000110000",
  ];
  const width = sprite[0].length * pixel;
  const height = sprite.length * pixel;
  const startX = Math.round(x - width / 2);
  const startY = Math.round(y - height / 2);

  ctx.fillStyle = "#8b5e34";
  sprite.forEach((row, rowIndex) => {
    row.split("").forEach((cell, colIndex) => {
      if (cell === "1") {
        ctx.fillRect(startX + colIndex * pixel, startY + rowIndex * pixel, pixel, pixel);
      }
    });
  });

  ctx.fillStyle = "#1f1b17";
  ctx.fillRect(startX + 2 * pixel, startY + 3 * pixel, pixel, pixel);
  ctx.fillRect(startX + 6 * pixel, startY + 3 * pixel, pixel, pixel);

  ctx.fillStyle = "#d9a46f";
  ctx.fillRect(startX + 4 * pixel, startY + 4 * pixel, pixel, pixel);
  ctx.fillRect(startX + 5 * pixel, startY + 4 * pixel, pixel, pixel);
};

const drawArrowMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#16a34a";
  ctx.fillStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size, y);
  ctx.lineTo(x + size - 8, y - 6);
  ctx.lineTo(x + size - 8, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawSadFace = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.save();
  ctx.font = "24px 'Space Mono', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fef3c7";
  ctx.fillText("😞", x, y - 12);
  ctx.restore();
};

const drawCelebrate = (ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "38px 'Space Mono', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fef3c7";
  ctx.fillText("🎉", x, y - 6);
  ctx.restore();
};

const drawPixelTile = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  palette: string[],
  seed: number,
  time: number,
  animate: boolean
) => {
  const pixel = Math.max(2, Math.floor(size / 6));
  const cols = Math.ceil(size / pixel);
  const rows = Math.ceil(size / pixel);
  const timeSeed = animate ? Math.floor(time / 140) : 0;
  let idx = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const rand = (((seed + idx + timeSeed * 31) * 9301 + 49297) % 233280) / 233280;
      const color = palette[Math.floor(rand * palette.length)];
      ctx.fillStyle = color;
      ctx.fillRect(x + col * pixel, y + row * pixel, pixel, pixel);
      idx += 1;
    }
  }
};

const animateRun = (
  canvas: HTMLCanvasElement,
  grid: Tile[][],
  path: Array<{ row: number; col: number }>,
  getSpeed: () => number,
  options: { death?: boolean; win?: boolean; frames?: Tile[][][] } = {}
): Promise<void> => {
  return new Promise((resolve) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    resolve();
    return;
  }
  const cols = grid[0].length;
  const { tileSize, gap, offsetX, offsetY } = getGridLayout(canvas, cols, {}, GAME_MAX_TILE_SIZE);

  const drawTile = (tile: Tile, time: number) => {
    const x = offsetX + tile.col * (tileSize + gap);
    const y = offsetY + tile.row * (tileSize + gap);
    if (tile.type === "lava") {
      drawPixelTile(ctx, x, y, tileSize, ["#ea580c", "#f97316", "#fb923c", "#facc15", "#fde047"], tile.row * 97 + tile.col * 131, time, true);
    } else if (tile.type === "solid") {
      drawPixelTile(
        ctx,
        x,
        y,
        tileSize,
        ["#201b17", "#332c26", "#4a4037", "#5a4f45", "#73665a", "#8a7b6d"],
        tile.row * 71 + tile.col * 53,
        time,
        false
      );
    } else {
      const wear = Math.max(0, SHALLOW_MAX_STEPS - tile.stepsLeft);
      const palette = wear > 0
        ? ["#5b544f", "#6d635c", "#82776f", "#988b81", "#b3a69a"]
        : ["#72675f", "#8a7f76", "#a5998e", "#c0b3a7", "#d8cbbf"];
      drawPixelTile(ctx, x, y, tileSize, palette, tile.row * 59 + tile.col * 89, time, false);
    }
  };

  if (path.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frame = options.frames?.[0] ?? grid;
    frame.forEach((row) => row.forEach((tile) => drawTile(tile, performance.now())));
    resolve();
    return;
  }
  const totalSteps = Math.max(1, path.length - 1);
  let startTime: number | null = null;
  let lastTime: number | null = null;
  let virtualElapsed = 0;

  const render = (time: number) => {
    if (startTime === null) startTime = time;
    if (lastTime === null) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;
    virtualElapsed += delta * getSpeed();
    const rawIndex = Math.floor(virtualElapsed / BASE_STEP_DURATION);
    const stepIndex = Math.min(totalSteps - 1, rawIndex);
    const stepProgress = Math.min(1, (virtualElapsed - stepIndex * BASE_STEP_DURATION) / BASE_STEP_DURATION);
    const eased = 0.5 - Math.cos(stepProgress * Math.PI) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frameList = options.frames;
    const frameIndex = frameList ? Math.min(stepIndex, Math.max(0, frameList.length - 1)) : 0;
    const frame = frameList?.[frameIndex] ?? grid;
    frame.forEach((row) => row.forEach((tile) => drawTile(tile, time)));

    if (path.length > 0 && virtualElapsed < 1200) {
      const start = path[0];
      const arrowX = offsetX - 26;
      const arrowY = offsetY + start.row * (tileSize + gap) + tileSize / 2;
      drawArrowMarker(ctx, arrowX, arrowY, 18, 1 - virtualElapsed / 1200);
    }

    const from = path[stepIndex];
    const to = path[stepIndex + 1] || path[stepIndex];
    const fromX = offsetX + from.col * (tileSize + gap) + tileSize / 2;
    const fromY = offsetY + from.row * (tileSize + gap) + tileSize / 2;
    const toX = offsetX + to.col * (tileSize + gap) + tileSize / 2;
    const toY = offsetY + to.row * (tileSize + gap) + tileSize / 2;
    const highlightX = offsetX + to.col * (tileSize + gap);
    const highlightY = offsetY + to.row * (tileSize + gap);
    ctx.save();
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 3;
    ctx.strokeRect(highlightX - 1, highlightY - 1, tileSize + 2, tileSize + 2);
    ctx.restore();
    const jump = Math.sin(stepProgress * Math.PI) * tileSize * 0.5;
    const avatarX = fromX + (toX - fromX) * eased;
    const avatarY = fromY + (toY - fromY) * eased - jump;
    drawPixelAvatar(ctx, avatarX, avatarY, tileSize * 1.6);

    if (virtualElapsed >= totalSteps * BASE_STEP_DURATION) {
      if (options.win) {
        const last = path[path.length - 1] || { row: 3, col: maxCol };
        const winX = offsetX + last.col * (tileSize + gap) + tileSize / 2;
        const winY = offsetY + last.row * (tileSize + gap) + tileSize / 2;
        const start = performance.now();
        const show = (t: number) => {
          const elapsed = t - start;
          const progress = Math.min(1, elapsed / 700);
          const bounce = Math.sin(progress * Math.PI);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const frameList = options.frames;
          const frameIndex = frameList ? Math.min(stepIndex, Math.max(0, frameList.length - 1)) : 0;
          const frame = frameList?.[frameIndex] ?? grid;
          frame.forEach((row) => row.forEach((tile) => drawTile(tile, t)));
          drawCelebrate(ctx, winX, winY - bounce * 14, 1 - progress * 0.2);
          if (elapsed < 700) {
            requestAnimationFrame(show);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(show);
        return;
      }
      if (options.death) {
        const last = path[path.length - 1];
        const sadX = offsetX + last.col * (tileSize + gap) + tileSize / 2;
        const sadY = offsetY + last.row * (tileSize + gap) + tileSize / 2;
        drawSadFace(ctx, sadX, sadY);
        setTimeout(resolve, 800);
        return;
      }
      resolve();
      return;
    }
    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
  });
};

const form = document.getElementById("game-form") as HTMLFormElement;
const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const yearSelect = document.getElementById("year") as HTMLSelectElement;
const startWeekInput = document.getElementById("startWeek") as HTMLInputElement;
const weeksInput = document.getElementById("weeks") as HTMLInputElement;
const hardModeInput = document.getElementById("hardMode") as HTMLInputElement;
const errorEl = document.getElementById("formError") as HTMLParagraphElement;
const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const scoreValue = document.getElementById("scoreValue") as HTMLDivElement;
const scoreBreakdown = document.getElementById("scoreBreakdown") as HTMLUListElement;
const scoreModal = document.getElementById("scoreModal") as HTMLDivElement;
const closeScore = document.getElementById("closeScore") as HTMLButtonElement;
const playAgain = document.getElementById("playAgain") as HTMLButtonElement;
const attemptMeta = document.getElementById("attemptMeta") as HTMLParagraphElement;
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));
const footerYear = document.getElementById("footerYear") as HTMLSpanElement | null;

let animationSpeed = 0.6;
let isRunning = false;

const availableYears = Array.from({ length: YEAR_OPTION_COUNT }, (_, index) => {
  return new Date().getUTCFullYear() - index;
});

const populateYearOptions = () => {
  yearSelect.innerHTML = "";
  availableYears.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  });
};

const getSelectedYear = () => {
  const year = Number(yearSelect.value);
  return Number.isNaN(year) ? availableYears[0] : year;
};

const setStartWeekForYear = (year: number) => {
  const janFirst = new Date(Date.UTC(year, 0, 1));
  startWeekInput.value = formatISODate(getWeekStartUTC(janFirst));
};

const syncWeeksForStart = (forceValue = false) => {
  const latestStart = getLatestStartWeek();
  startWeekInput.max = formatISODate(latestStart);
  if (!startWeekInput.value) return;
  const startDate = parseISODate(startWeekInput.value);
  if (startDate > latestStart) {
    startWeekInput.value = formatISODate(latestStart);
  }
  const selectedYear = parseISODate(startWeekInput.value).getUTCFullYear();
  if (availableYears.includes(selectedYear) && yearSelect.value !== String(selectedYear)) {
    yearSelect.value = String(selectedYear);
  }
  const maxWeeks = getMaxWeeksForStart(startWeekInput.value);
  weeksInput.max = String(maxWeeks);
  const currentWeeks = Number(weeksInput.value);
  if (forceValue || Number.isNaN(currentWeeks) || currentWeeks > maxWeeks) {
    weeksInput.value = String(maxWeeks);
  }
};

populateYearOptions();
if (availableYears.length > 0) {
  yearSelect.value = String(availableYears[0]);
  setStartWeekForYear(availableYears[0]);
  syncWeeksForStart(false);
  startWeekInput.min = `${availableYears[availableYears.length - 1]}-01-01`;
}

const updateSpeedButtons = () => {
  speedButtons.forEach((button) => {
    const value = Number(button.dataset.speed);
    button.classList.toggle("is-active", value === animationSpeed);
  });
};

const setAnimationSpeed = (value: number) => {
  animationSpeed = value;
  updateSpeedButtons();
};

speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const value = Number(button.dataset.speed);
    if (!Number.isNaN(value)) setAnimationSpeed(value);
  });
});

updateSpeedButtons();

const setScoreModalVisible = (visible: boolean) => {
  scoreModal.classList.toggle("is-visible", visible);
  scoreModal.setAttribute("aria-hidden", visible ? "false" : "true");
};

closeScore.addEventListener("click", () => setScoreModalVisible(false));
playAgain.addEventListener("click", () => {
  setScoreModalVisible(false);
  attemptMeta.textContent = "Adjust the selection, then press Play.";
  updatePreviewDisplay();
});
scoreModal.addEventListener("click", (event) => {
  if (event.target === scoreModal) setScoreModalVisible(false);
});

providerSelect.addEventListener("change", () => {
  schedulePreviewFetch();
});
usernameInput.addEventListener("input", () => {
  schedulePreviewFetch();
});
yearSelect.addEventListener("change", () => {
  const year = Number(yearSelect.value);
  if (!Number.isNaN(year)) {
    setStartWeekForYear(year);
    syncWeeksForStart(true);
    updatePreviewDisplay();
    schedulePreviewFetch();
  }
});
startWeekInput.addEventListener("input", () => {
  if (startWeekInput.value) {
    const normalized = formatISODate(getWeekStartUTC(parseISODate(startWeekInput.value)));
    if (normalized !== startWeekInput.value) {
      startWeekInput.value = normalized;
    }
    const year = parseISODate(startWeekInput.value).getUTCFullYear();
    if (availableYears.includes(year) && yearSelect.value !== String(year)) {
      yearSelect.value = String(year);
    }
  }
  syncWeeksForStart(false);
  updatePreviewDisplay();
});
weeksInput.addEventListener("input", () => {
  const maxWeeks = Number(weeksInput.max);
  const currentWeeks = Number(weeksInput.value);
  if (!Number.isNaN(currentWeeks) && !Number.isNaN(maxWeeks) && currentWeeks > maxWeeks) {
    weeksInput.value = String(maxWeeks);
  }
  updatePreviewDisplay();
});

const updateScoreDisplay = (
  best: AttemptScore | null,
  breakdown: ScoreBreakdown | null,
  attemptScores: AttemptScore[] = []
) => {
  if (!best || !breakdown) {
    scoreValue.textContent = "--";
    scoreBreakdown.innerHTML = "";
    return;
  }
  scoreValue.textContent = `${best.total}`;
  scoreBreakdown.innerHTML = "";
  const items = [
    `Base: ${breakdown.base}`,
    `Progress: ${breakdown.progress}`,
    `Win bonus: ${breakdown.winBonus}`,
    `Death penalty: ${breakdown.deathPenalty}`,
    `Jump bonus: ${breakdown.jumpBonus}`,
  ];
  if (breakdown.hardModeBonus > 0) {
    items.push(`Hard mode bonus: ${breakdown.hardModeBonus}`);
  }
  if (attemptScores.length > 0) {
    const attemptLabel = attemptScores
      .map((score) => (score.skipped ? "skip" : String(score.total)))
      .join(", ");
    items.push(`Attempt scores: ${attemptLabel}`);
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    scoreBreakdown.appendChild(li);
  });
};

let previewTimer: number | null = null;
let previewRequestId = 0;
let lastPreviewKey = "";
let previewGrid: RawTile[][] | null = null;
let previewMeta: {
  startWeek: string;
  weeks: number;
  from: string;
  to: string;
  year: number;
  displayFrom: string;
  displayTo: string;
} | null = null;

const getSelectionRange = () => {
  if (!previewMeta) return null;
  const startWeekValue = startWeekInput.value;
  const weeksValue = Number(weeksInput.value);
  if (!startWeekValue || Number.isNaN(weeksValue)) return null;
  const selectionStart = parseISODate(startWeekValue);
  const previewStart = parseISODate(previewMeta.from);
  const startCol = diffWeeks(previewStart, selectionStart);
  const endCol = startCol + weeksValue - 1;
  return { startCol, endCol };
};

const updatePreviewDisplay = () => {
  if (!previewGrid || !previewMeta) return;
  const selection = getSelectionRange();
  let visibleCols: number | undefined;
  if (selection && startWeekInput.value) {
    const selectedYear = parseISODate(startWeekInput.value).getUTCFullYear();
    if (selectedYear === getTodayUTC().getUTCFullYear()) {
      const maxWeeks = getMaxWeeksForStart(startWeekInput.value);
      visibleCols = Math.max(0, selection.startCol + maxWeeks);
    }
  }
  renderPreview(canvas, previewGrid, previewMeta, selection, visibleCols);
};

const schedulePreviewFetch = () => {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    loadPreview();
  }, PREVIEW_IDLE_MS);
};

const loadPreview = async () => {
  const provider = providerSelect.value;
  const username = usernameInput.value.trim();
  if (!username) return;
  const gitlabHost = "gitlab.com";
  const preview = buildPreviewRange(getSelectedYear());
  const cacheKey = `${provider}:${username}:${gitlabHost}:${preview.from}:${preview.to}`;
  if (cacheKey === lastPreviewKey) return;
  lastPreviewKey = cacheKey;
  const requestId = ++previewRequestId;
  attemptMeta.textContent = "Loading contributions...";
  errorEl.textContent = "";

  try {
    const result = await fetchContribWithFallback({
      provider,
      username,
      from: preview.from,
      to: preview.to,
      gitlabHost,
    });
    const data = result.data;
    if (requestId !== previewRequestId) return;
    if (result.provider !== providerSelect.value) {
      providerSelect.value = result.provider;
    }
    previewGrid = buildRawGrid(data.days, preview.startWeek, preview.weeks);
    previewMeta = preview;
    updatePreviewDisplay();
    attemptMeta.textContent = `Previewing ${preview.year} (${preview.displayFrom} to ${preview.displayTo}).`;
  } catch (error) {
    if (requestId !== previewRequestId) return;
    errorEl.textContent = error instanceof Error ? error.message : "Failed to load contributions.";
  }
};

const runGame = async () => {
  if (isRunning) return;
  isRunning = true;
  errorEl.textContent = "";
  setScoreModalVisible(false);
  let provider = providerSelect.value;
  const username = usernameInput.value.trim();
  const startWeek = startWeekInput.value;
  const weeks = Number(weeksInput.value);
  const hardMode = hardModeInput.checked;
  const gitlabHost = "gitlab.com";

  if (!username || !startWeek || Number.isNaN(weeks)) {
    errorEl.textContent = "Fill out all fields.";
    isRunning = false;
    return;
  }
  const maxWeeks = getMaxWeeksForStart(startWeek);
  if (maxWeeks < 1 || weeks < 1 || weeks > maxWeeks) {
    errorEl.textContent = `Weeks must be between 1 and ${Math.max(1, maxWeeks)} for the selected start week.`;
    isRunning = false;
    return;
  }

  try {
    const attemptCount = 7;
    const range = buildRange(startWeek, weeks);
    const result = await fetchContribWithFallback({ provider, username, from: range.from, to: range.to, gitlabHost });
    provider = result.provider;
    if (provider !== providerSelect.value) {
      providerSelect.value = provider;
    }
    const data = result.data;
    const rawGrid = buildRawGrid(data.days, startWeek, weeks);
    const sharedGrid = hardMode ? toGameGrid(rawGrid) : null;

    const results: AttemptScore[] = [];
    const grids: Tile[][][] = [];
    const paths: Array<Array<{ row: number; col: number }>> = [];
    const frames: Array<Tile[][][] | undefined> = [];
    const hardModeBonus = hardMode ? HARD_MODE_BONUS : 0;

    for (let row = 0; row < attemptCount; row += 1) {
      const grid = hardMode && sharedGrid ? sharedGrid : toGameGrid(rawGrid);
      const result = simulateRun(grid, row, hardMode ? { clone: false } : undefined);
      const scored = result.skipped
        ? {
          total: 0,
          breakdown: { base: 0, progress: 0, winBonus: 0, deathPenalty: 0, jumpBonus: 0, hardModeBonus: 0 },
        }
        : scoreRun(weeks, result);
      results.push({
        total: scored.total,
        breakdown: scored.breakdown,
        attempt: row,
        startWeek,
        win: result.win,
        reachedColumns: result.reachedColumns,
        death: result.death,
        skipped: result.skipped,
      });
      grids.push(result.grid);
      paths.push(result.path);
      frames.push(result.frames);
    }

    const sortable = results.filter((result) => !result.skipped);
    const best = (sortable.length ? sortable : results).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.win !== a.win) return Number(b.win) - Number(a.win);
      return b.reachedColumns - a.reachedColumns;
    })[0];

    const bestIndex = best.attempt;
    if (hardMode) {
      best.total += hardModeBonus;
      best.breakdown.hardModeBonus = hardModeBonus;
    }
    updateScoreDisplay(best, best.breakdown, results);

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (let i = 0; i < attemptCount; i += 1) {
      const winEmoji = results[i].win ? " 🎉" : "";
      const attemptLabel = `Attempt #${i + 1} (${dayNames[i]})${winEmoji}`;
      if (results[i].skipped) {
        attemptMeta.textContent = `${attemptLabel} skipped (lava start)`;
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      attemptMeta.textContent = attemptLabel;
      const didDie = results[i].death;
      await animateRun(canvas, grids[i], paths[i], () => animationSpeed, {
        death: didDie,
        win: results[i].win,
        frames: frames[i],
      });
    }

    const bestDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][bestIndex];
    const winEmoji = best.win ? " 🎉" : "";
    attemptMeta.textContent = `Best attempt: #${bestIndex + 1} (${bestDay}). Reached ${best.reachedColumns}/${weeks} columns.${winEmoji}`;
    setScoreModalVisible(true);

  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : "Something went wrong.";
  } finally {
    isRunning = false;
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runGame();
});

const prefillFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("provider");
  const username = params.get("username");
  const weeks = params.get("weeks");
  const startWeek = params.get("startWeek");
  const yearParam = params.get("year");
  if (provider) providerSelect.value = provider;
  if (username) usernameInput.value = username;
  if (weeks) weeksInput.value = weeks;
  let selectedYear = availableYears[0];
  if (yearParam) {
    const parsedYear = Number(yearParam);
    if (availableYears.includes(parsedYear)) selectedYear = parsedYear;
  } else if (startWeek) {
    const parsedYear = parseISODate(startWeek).getUTCFullYear();
    if (availableYears.includes(parsedYear)) selectedYear = parsedYear;
  }
  yearSelect.value = String(selectedYear);
  if (startWeek) {
    startWeekInput.value = formatISODate(getWeekStartUTC(parseISODate(startWeek)));
  } else {
    setStartWeekForYear(selectedYear);
  }
  syncWeeksForStart(!weeks);
  if (usernameInput.value.trim()) {
    schedulePreviewFetch();
  }
};

prefillFromQuery();
if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}
