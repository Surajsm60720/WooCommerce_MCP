import type { NextFunction, Request, Response } from "express";
import type { Role, User } from "@prisma/client";
import { findApiKeyAuth, verifyToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export type AuthedRequest = Request & {
  user?: User;
  /** Set when the caller authenticated with a gateway API key (not JWT). */
  apiKeyId?: string;
};

export async function requireJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/** Accept dashboard JWT or gateway API key */
export async function requireJwtOrApiKey(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (token.startsWith("mcp_")) {
      const auth = await findApiKeyAuth(token);
      if (!auth) {
        res.status(401).json({ error: "API key revoked or invalid" });
        return;
      }
      req.user = auth.user;
      req.apiKeyId = auth.apiKeyId;
      next();
      return;
    }
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
