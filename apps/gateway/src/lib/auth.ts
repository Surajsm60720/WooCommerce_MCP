import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import type { Role, User } from "@prisma/client";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(user: Pick<User, "id" | "email" | "role">): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function generateApiKey(): { raw: string; prefix: string; keyHash: string } {
  const raw = `mcp_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  const keyHash = hashApiKey(raw);
  return { raw, prefix, keyHash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function findApiKeyAuth(raw: string) {
  const prefix = raw.slice(0, 12);
  const keyHash = hashApiKey(raw);
  const key = await prisma.apiKey.findFirst({
    where: { prefix, keyHash, revokedAt: null },
    include: { user: true },
  });
  if (!key) return null;
  return { user: key.user, apiKeyId: key.id };
}

/** @deprecated use findApiKeyAuth */
export async function findUserByApiKey(raw: string) {
  const auth = await findApiKeyAuth(raw);
  return auth?.user ?? null;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
