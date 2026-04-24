import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodSchema } from "zod";
import { badRequest } from "./error-middleware";

/**
 * Validation middleware. Parses `req.body` / `req.query` / `req.params`
 * against a Zod schema and assigns the PARSED value back so handlers
 * see sanitised, correctly-typed data.
 *
 * Usage:
 *   const body = z.object({ scope: z.enum(["global","protocol"]), ... });
 *   app.post("/x", requireAuth, validateBody(body), asyncHandler(async (req) => {
 *     // req.body is now typed from the schema
 *   }));
 */
function runValidation<T>(
  schema: ZodSchema<T>,
  source: "body" | "query" | "params",
): RequestHandler {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse((req as any)[source]);
      (req as any)[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Compact error shape: path string + message for each issue.
        const details = err.issues.map(i => ({
          path: i.path.join("."),
          message: i.message,
        }));
        return next(badRequest(`Invalid ${source}`, details));
      }
      next(err);
    }
  };
}

export const validateBody = <T>(schema: ZodSchema<T>) => runValidation(schema, "body");
export const validateQuery = <T>(schema: ZodSchema<T>) => runValidation(schema, "query");
export const validateParams = <T>(schema: ZodSchema<T>) => runValidation(schema, "params");
