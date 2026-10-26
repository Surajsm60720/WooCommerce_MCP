import { Router } from "express";
import { requireJwt } from "../middleware/auth.js";
import { getPermissionPolicies } from "../services/permissions.js";

export const permissionsRouter = Router();

permissionsRouter.use(requireJwt);

permissionsRouter.get("/", (_req, res) => {
  res.json({
    policies: getPermissionPolicies(),
    enforcement:
      "tools/list is filtered by role; direct calls to denied tools are rejected and audited.",
  });
});
