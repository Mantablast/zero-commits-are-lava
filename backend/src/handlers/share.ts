import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { htmlResponse } from "../utils";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const buildShareHtml = (options: {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  imageType: string;
  url: string;
  frontendUrl: string;
  payload: Record<string, string | undefined>;
}) => {
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const { title, description, image, imageAlt, imageWidth, imageHeight, imageType, url, frontendUrl, payload } = options;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImageAlt = escapeHtml(imageAlt);
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (!value) return;
    params.set(key, value);
  });
  const playUrl = params.toString() ? `${frontendUrl}?${params.toString()}` : frontendUrl;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:alt" content="${safeImageAlt}" />
    <meta property="og:image:width" content="${imageWidth}" />
    <meta property="og:image:height" content="${imageHeight}" />
    <meta property="og:image:type" content="${imageType}" />
    <meta property="og:url" content="${url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${image}" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #0e0c0a; color: #f7f0e8; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 48px 24px; text-align: center; }
      h1 { font-size: 2.2rem; margin-bottom: 12px; }
      p { opacity: 0.9; margin: 0 0 24px; }
      a { color: #ffb347; text-decoration: none; font-weight: 600; }
      .cta { display: inline-block; padding: 12px 20px; border-radius: 999px; background: #ff6f3c; color: #0b0a08; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>
        <h1>${safeTitle}</h1>
        <p>${safeDescription}</p>
        <a class="cta" href="${playUrl}">Play it yourself →</a>
      </div>
    </div>
    <script>
      // Redirect humans to the interactive experience after a short delay.
      setTimeout(function () { window.location.href = "${playUrl}"; }, 1200);
    </script>
  </body>
</html>`;
};

export const handler = async (event: APIGatewayProxyEventV2) => {
  const query = event.queryStringParameters || {};
  const provider = query.provider || "github";
  const username = query.username || "";
  const weeks = query.weeks || "";
  const startWeek = query.startWeek || "";
  const bestScore = query.bestScore || "";
  const win = query.win || "";

  const frontendUrl = normalizeBaseUrl(process.env.FRONTEND_BASE_URL || "https://example.com");
  const publicBaseUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || frontendUrl);
  const url = `${publicBaseUrl}/share${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const imageParams = new URLSearchParams();
  if (username) imageParams.set("username", username);
  if (bestScore) imageParams.set("bestScore", bestScore);
  const imageQuery = imageParams.toString();
  const image = `${publicBaseUrl}/share-image${imageQuery ? `?${imageQuery}` : ""}`;

  const title = username
    ? `${username} just crossed the lava field!`
    : "ZeroCommitsAreLava";
  const description = bestScore
    ? `Best score ${bestScore} across ${weeks || "?"} weeks. ${win === "true" ? "Made it to the far edge." : "Still chasing the exit."}`
    : "Turn your contribution streak into a lava-running puzzle.";
  const imageAlt = bestScore ? `Top score ${bestScore}` : "Zero Commits Are Lava";

  const html = buildShareHtml({
    title,
    description,
    image,
    imageAlt,
    imageWidth: 1200,
    imageHeight: 630,
    imageType: "image/svg+xml",
    url,
    frontendUrl,
    payload: {
      provider,
      username,
      weeks,
      startWeek,
    },
  });

  return htmlResponse(200, html);
};
