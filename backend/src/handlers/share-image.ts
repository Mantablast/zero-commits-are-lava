import type { APIGatewayProxyEventV2 } from "aws-lambda";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const formatScore = (value: string | undefined) => {
  if (!value) return "--";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "--";
  return String(Math.max(0, Math.round(parsed)));
};

const buildShareSvg = (options: {
  scoreText: string;
  username: string;
  logoUrl: string;
  burnedUrl: string;
}) => {
  const scoreText = escapeXml(options.scoreText);
  const safeUser = escapeXml(options.username.replace(/^@/, "").slice(0, 24));
  const usernameLine = safeUser ? `@${safeUser}` : "Run the gauntlet";
  const logoUrl = escapeXml(options.logoUrl);
  const burnedUrl = escapeXml(options.burnedUrl);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${OG_WIDTH}" y2="${OG_HEIGHT}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#140b08"/>
      <stop offset="1" stop-color="#5a1f0b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(880 210) rotate(90) scale(260 260)">
      <stop stop-color="#fbbf24" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)" />
  <rect x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)" />

  <image href="${logoUrl}" x="72" y="64" width="120" height="120" />

  <text x="72" y="230" fill="#fde68a" font-size="36" font-family="Space Grotesk, Trebuchet MS, Segoe UI, sans-serif" font-weight="700">
    Zero Commits Are Lava
  </text>
  <text x="72" y="288" fill="#fef3c7" font-size="26" font-family="Space Grotesk, Trebuchet MS, Segoe UI, sans-serif">
    Top score
  </text>
  <text x="72" y="400" fill="#ffffff" font-size="120" font-family="Space Grotesk, Trebuchet MS, Segoe UI, sans-serif" font-weight="700">
    ${scoreText}
  </text>
  <text x="72" y="450" fill="#fdba74" font-size="26" font-family="Space Mono, ui-monospace, monospace">
    ${usernameLine}
  </text>

  <rect x="700" y="86" width="428" height="458" rx="40" fill="#1b120e" fill-opacity="0.65" stroke="#f97316" stroke-opacity="0.6" stroke-width="3"/>
  <image href="${burnedUrl}" x="730" y="110" width="368" height="410" />
</svg>`;
};

export const handler = async (event: APIGatewayProxyEventV2) => {
  const query = event.queryStringParameters || {};
  const username = query.username || "";
  const scoreText = formatScore(query.bestScore || query.score);
  const frontendBase = normalizeBaseUrl(process.env.FRONTEND_BASE_URL || "");
  const publicBase = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || frontendBase);
  const assetBase = publicBase || frontendBase || "https://example.com";
  const logoUrl = `${assetBase}/og/logo.png`;
  const burnedUrl = `${assetBase}/og/burnedbutt.png`;

  const svg = buildShareSvg({ scoreText, username, logoUrl, burnedUrl });

  return {
    statusCode: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
    body: svg,
  };
};
