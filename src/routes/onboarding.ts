import { Router } from "express";

const router = Router();

router.post("/complete", (_req, res) => {
  return res.status(410).json({
    error: "Legacy onboarding is disabled. Use POST /auth/invites/activate with a valid invite token.",
  });
});

export default router;
