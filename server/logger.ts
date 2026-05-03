import pino, { type Logger } from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";

const isProd = process.env.NODE_ENV === "production";

// Structured JSON in prod (CloudWatch-friendly); pretty-printed in dev.
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.apiKey",
      "*.api_key",
      "*.privateKey",
      "*.private_key",
      "*.secret",
      "*.token",
    ],
    remove: true,
  },
});

// Honors an upstream X-Request-ID (e.g. ALB/CloudFront) and echoes it back
// so a single request can be followed across logs and clients.
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && incoming ? incoming : randomUUID();
    res.setHeader("X-Request-ID", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, id: req.id }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  // Skip static asset / Vite HMR noise — only log API traffic.
  autoLogging: {
    ignore: (req) => !(req.url || "").startsWith("/api/"),
  },
});
