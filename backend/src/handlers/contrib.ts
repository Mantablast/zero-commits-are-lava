import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { NormalizedContrib } from "../types";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  buildCacheKey,
  getAllowedOrigins,
  getEnvNumber,
  isValidHost,
  isValidISODate,
  isValidUsername,
  jsonResponse,
  parseProvider,
  pickAllowedOrigin,
  validateDateRange,
} from "../utils";
import { getCacheEntry, putCacheEntry } from "../cache";
import { fetchProviderDays } from "../providers";

const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_MAX = 40;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const isRateLimited = (ip: string | undefined): boolean => {
  if (!ip) return false;
  const now = Date.now();
  const existing = rateLimitMap.get(ip);
  if (!existing || existing.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX) return true;
  return false;
};

export const handler = async (event: APIGatewayProxyEventV2) => {
  const originHeader = event.headers.origin || (event.headers as Record<string, string | undefined>).Origin;
  const origin = pickAllowedOrigin(originHeader, getAllowedOrigins());
  const query = event.queryStringParameters || {};
  const provider = parseProvider(query.provider);
  const username = query.username;
  const from = query.from;
  const to = query.to;
  const gitlabHost = query.gitlabHost || "gitlab.com";

  if (isRateLimited(event.requestContext?.http?.sourceIp)) {
    return jsonResponse(429, { error: "Too many requests. Try again shortly." }, origin);
  }

  if (!provider) {
    return jsonResponse(400, { error: "Invalid provider." }, origin);
  }
  if (!isValidUsername(username)) {
    return jsonResponse(400, { error: "Invalid username." }, origin);
  }
  if (!isValidISODate(from) || !isValidISODate(to)) {
    return jsonResponse(400, { error: "Invalid date format. Use YYYY-MM-DD." }, origin);
  }
  if (!isValidHost(gitlabHost)) {
    return jsonResponse(400, { error: "Invalid GitLab host." }, origin);
  }
  const rangeError = validateDateRange(from, to);
  if (rangeError) {
    return jsonResponse(400, { error: rangeError }, origin);
  }

  const cacheKey = buildCacheKey(provider, username, from, to, gitlabHost);
  const now = Math.floor(Date.now() / 1000);
  const cached = await getCacheEntry(cacheKey);
  if (cached && cached.expiresAt > now) {
    try {
      const parsed = JSON.parse(cached.payload) as NormalizedContrib;
      console.log("cacheHit", { cacheKey, provider, username });
      return jsonResponse(200, parsed, origin, {
        "cache-control": "public, max-age=300",
      });
    } catch (error) {
      console.warn("cacheParseFail", error);
    }
  }

  console.log("cacheMiss", { cacheKey, provider, username });
  try {
    const days = await fetchProviderDays(provider, username, from, to, gitlabHost);
    const payload: NormalizedContrib = {
      provider,
      username,
      from,
      to,
      days,
    };
    const ttlSeconds = getEnvNumber(process.env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS);
    await putCacheEntry(cacheKey, {
      payload: JSON.stringify(payload),
      fetchedAt: now,
      expiresAt: now + ttlSeconds,
    });
    return jsonResponse(200, payload, origin, {
      "cache-control": "public, max-age=300",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream error";
    return jsonResponse(502, { error: message }, origin);
  }
};
