import { Router } from "express";
import { z } from "zod";
import { requireJwt, type AuthedRequest } from "../middleware/auth.js";
import { runChat } from "../services/chat.js";

export const chatRouter = Router();

chatRouter.use(requireJwt);

chatRouter.post("/", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      message: z.string().min(1),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        )
        .optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  try {
    const result = await runChat(req.user!, body.data.message, body.data.history ?? []);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Chat failed",
    });
  }
});
