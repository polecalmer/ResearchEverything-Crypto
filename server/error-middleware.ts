import type { ErrorRequestHandler, Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Structured HTTP error. Throw this from a route handler (or use asyncHandler
 * below) and the central middleware will serialise it consistently.
 *
 * Server-side detail (`expose: false`) stays in logs; client only sees the
 * `message` when `expose: true`. Matches the common "operational vs
 * programmer error" convention.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(status: number, message: string, opts: { expose?: boolean; details?: unknown } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.expose = opts.expose ?? status < 500;
    this.details = opts.details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, msg, { expose: true, details });
export const unauthorized = (msg = "Unauthorized") =>
  new HttpError(401, msg, { expose: true });
export const forbidden = (msg = "Forbidden") =>
  new HttpError(403, msg, { expose: true });
export const notFound = (msg = "Not found") =>
  new HttpError(404, msg, { expose: true });
export const conflict = (msg: string) =>
  new HttpError(409, msg, { expose: true });

/**
 * Wrap async route handlers so thrown errors surface to the Express error
 * middleware instead of becoming unhandled promise rejections.
 *
 * Example:
 *   app.get("/x", asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler<R = unknown>(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<R>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Central error-handling middleware. Register LAST in the Express pipeline
 * (after all routes + other middleware) via:
 *
 *   app.use(errorMiddleware);
 *
 * Replaces the ~90 duplicated `res.status(500).json({ message: e.message })`
 * blocks across the route files. Over time, route handlers should migrate
 * to throwing HttpError (or letting unexpected errors propagate) instead
 * of catching + res.status() inline.
 */
export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  // If a response is already streaming, delegate to Express' default handler.
  if (res.headersSent) return _next(err);

  if (err instanceof HttpError) {
    const payload: Record<string, unknown> = { message: err.expose ? err.message : "Internal error" };
    if (err.expose && err.details !== undefined) payload.details = err.details;
    if (err.status >= 500) {
      console.error(`[http ${err.status}] ${req.method} ${req.path}`, err);
    }
    res.status(err.status).json(payload);
    return;
  }

  // Unknown error — treat as 500, never leak internals to the client.
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[http 500] ${req.method} ${req.path}`, err);
  res.status(500).json({ message: "Internal error" });
  // Suppress unused param lint.
  void message;
};
