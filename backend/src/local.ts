import "dotenv/config";
import http from "node:http";
import url from "node:url";
import { handler as contribHandler } from "./handlers/contrib";
import { handler as shareHandler } from "./handlers/share";
import { handler as shareImageHandler } from "./handlers/share-image";

if (!process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS = "http://localhost:5173";
}
if (!process.env.FRONTEND_BASE_URL) {
  process.env.FRONTEND_BASE_URL = "http://localhost:5173";
}
if (!process.env.PUBLIC_BASE_URL) {
  process.env.PUBLIC_BASE_URL = "http://localhost:8787";
}

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);
  const event = {
    headers: {
      origin: req.headers.origin || "",
      host: req.headers.host || "",
      "x-forwarded-proto": "http",
    },
    rawQueryString: parsed.search ? parsed.search.slice(1) : "",
    queryStringParameters: parsed.query as Record<string, string>,
    requestContext: {
      http: {
        sourceIp: req.socket.remoteAddress || "",
      },
    },
  };

  let response;
  if (parsed.pathname === "/api/contrib") {
    response = await contribHandler(event as any);
  } else if (parsed.pathname === "/share") {
    response = await shareHandler(event as any);
  } else if (parsed.pathname === "/share-image") {
    response = await shareImageHandler(event as any);
  } else {
    response = {
      statusCode: 404,
      headers: { "content-type": "text/plain" },
      body: "Not found",
    };
  }

  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
});

server.listen(PORT, () => {
  console.log(`Local API listening on http://localhost:${PORT}`);
});
