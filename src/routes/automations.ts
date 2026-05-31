import { Router } from "express";
import scenesRoutes from "./scenes";

const router = Router();

// Keep one automation implementation while exposing the resident-facing route.
router.use((req, _res, next) => {
  req.url = `/automations${req.url === "/" ? "" : req.url}`;
  next();
}, scenesRoutes);

export default router;
