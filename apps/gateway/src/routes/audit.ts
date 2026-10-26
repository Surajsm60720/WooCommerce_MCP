import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireJwt, type AuthedRequest } from "../middleware/auth.js";

export const auditRouter = Router();

auditRouter.use(requireJwt);

auditRouter.get("/", async (req: AuthedRequest, res) => {
  const isAdmin = req.user!.role === "admin";
  const logs = await prisma.auditLog.findMany({
    where: isAdmin ? undefined : { userId: req.user!.id },
    include: { user: true, server: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(
    logs.map((l) => ({
      id: l.id,
      userEmail: l.user?.email ?? null,
      serverName: l.server?.name ?? null,
      toolName: l.toolName,
      success: l.success,
      errorMessage: l.errorMessage,
      durationMs: l.durationMs,
      createdAt: l.createdAt,
    })),
  );
});
