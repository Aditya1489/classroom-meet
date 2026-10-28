import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Validates whether a client-provided Request ID is safe to use.
 * Must be 8-64 characters of letters, digits, hyphens, and underscores.
 */
function isValidRequestId(id: string): boolean {
  return /^[a-zA-Z0-9\-_]{8,64}$/.test(id);
}

/**
 * Request ID Middleware
 *
 * Adopts incoming X-Request-Id header if valid; otherwise generates a secure UUIDv4.
 * Guarantees that X-Request-Id is set on the response and attached to req.requestId.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = (req.headers["x-request-id"] || req.headers["request-id"]) as string | undefined;

  let requestId: string;
  if (incoming && typeof incoming === "string" && isValidRequestId(incoming.trim())) {
    requestId = incoming.trim();
  } else {
    requestId = crypto.randomUUID();
  }

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
}
