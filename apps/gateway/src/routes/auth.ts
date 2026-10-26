import { Router } from "express";
import { z } from "zod";
import { publicUser, signToken, verifyPassword } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireJwt, type AuthedRequest } from "../middleware/auth.js";
import { config } from "../lib/config.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const body = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: body.data.email } });
  if (!user || !(await verifyPassword(body.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get("/me", requireJwt, async (req: AuthedRequest, res) => {
  res.json({ user: publicUser(req.user!) });
});

export const meRouter = Router();

meRouter.get("/", requireJwt, async (req: AuthedRequest, res) => {
  res.json({ user: publicUser(req.user!) });
});

meRouter.get("/gateway-info", requireJwt, async (_req, res) => {
  res.json({
    mcpUrl: `${config.publicGatewayUrl.replace(/\/$/, "")}/mcp`,
    instructions:
      "Add this URL as an MCP server (Streamable HTTP) and set Authorization: Bearer <your API key>. Tool names are namespaced as {serverSlug}__{toolName}.",
  });
});
