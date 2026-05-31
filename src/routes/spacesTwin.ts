import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { modelProvider, renderProvider, twinProvider } from "../services/twinProviderService";

const router = Router();
router.use(requireAuth);

function handle(provider: (actor: any) => Promise<Record<string, unknown>>) {
  return async (req: any, res: any) => {
    try {
      res.json(await provider(req.user));
    } catch (error: any) {
      if (error?.message === "scope_required") return res.status(403).json({ error: "Home or estate context required" });
      return res.status(500).json({ error: "Twin provider unavailable" });
    }
  };
}

router.get("/twin", handle((actor) => twinProvider.getTwin(actor)));
router.get("/model", handle((actor) => modelProvider.getModel(actor)));
router.get("/render", handle((actor) => renderProvider.getRender(actor)));

export default router;
