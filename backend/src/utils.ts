import type { Provider } from "./types";
import { createHash } from "node:crypto";

const USERNAME_REGEX = /^[A-Za-z0-9._-]+$/;
const HOST_REGEX = /^[A-Za-z0-9.-]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_WEEKS = 52;

export const DEFAULT_CACHE_TTL_SECONDS = 6 * 60 * 60;

export const parseProvider = (value: string | undefined): Provider | null => {
  if (value === "github" || value === "gitlab") return value;
  return null;
};

export const isValidUsername = (value: string | undefined): value is string => {
  if (!value) return false;
  return USERNAME_REGEX.test(value);
};

export const isValidHost = (value: string | undefined): value is string => {
  if (!value) return false;
  if (!HOST_REGEX.test(value)) return false;
  const host = value.toLowerCase().replace(/\.$/, "");
  return host === "gitlab.com";
};

export const isValidISODate = (value: string | undefined): value is string => {
  if (!value) return false;
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
};

export const parseISODate = (value: string): Date => {
  return new Date(`${value}T00:00:00Z`);
};

export const formatISODate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const listDateRange = (from: string, to: string): string[] => {
  const start = parseISODate(from);
  const end = parseISODate(to);
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(formatISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};

export const weeksBetween = (from: string, to: string): number => {
  const start = parseISODate(from);
  const end = parseISODate(to);
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.ceil(diffDays / 7);
};

export const hashCacheKey = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

export const getEnvNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getAllowedOrigins = (): string[] => {
  const raw = process.env.ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const pickAllowedOrigin = (origin: string | undefined, allowed: string[]): string | undefined => {
  if (!origin || allowed.length === 0) return undefined;
  return allowed.includes(origin) ? origin : undefined;
};

export const jsonResponse = (
  statusCode: number,
  payload: unknown,
  origin?: string,
  extraHeaders?: Record<string, string>
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["vary"] = "Origin";
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload),
  };
};

export const htmlResponse = (
  statusCode: number,
  body: string,
  extraHeaders?: Record<string, string>
) => {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...extraHeaders,
    },
    body,
  };
};

export const validateDateRange = (from: string, to: string): string | null => {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (end < start) return "The 'to' date must be after 'from'.";
  const maxDays = MAX_WEEKS * 7;
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (diffDays > maxDays) return `Date range exceeds ${MAX_WEEKS} weeks.`;
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (end > todayUTC) return "Date range cannot end in the future.";
  return null;
};

export const buildCacheKey = (provider: Provider, username: string, from: string, to: string, gitlabHost: string) => {
  return hashCacheKey(`${provider}:${username}:${from}:${to}:${gitlabHost}`);
};
