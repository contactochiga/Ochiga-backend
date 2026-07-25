// src/controllers/signal.controller.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { Signal } from "../core/control-plane/contracts/signal.types";

export async function ingestSignal(req: any, res: Response) {
  try {
    const raw = req.body;

    if (!raw?.type) {
      return res.status(400).json({ error: "Invalid signal payload" });
    }

    // ✅ Normalize common aliases
    let type = raw.type;
    if (type === "device.command") type = "device.command.requested";

    const signal: any = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: raw.source ?? "user",
      type,
      timestamp: new Date().toISOString(),
      ...raw,
      estateId: raw.estateId || raw.estate_id || req.oisContext?.estate_id || req.user?.estate_id || null,
      homeId: raw.homeId || raw.home_id || req.oisContext?.home_id || req.user?.home_id || null,
      unitId: raw.unitId || raw.unit_id || raw.homeId || raw.home_id || req.oisContext?.home_id || req.user?.home_id || null,
    };

    // ✅ If device command and requestedBy missing, derive from auth user
    if (
      signal.type === "device.command.requested" &&
      !signal.requestedBy &&
      req.user
    ) {
      signal.requestedBy = {
        userId: req.user.id,
        role: req.user.role,
      };
    }
    if (signal.type === "device.command.requested" && !signal.deviceScope) {
      signal.deviceScope = signal.homeId ? "home" : signal.estateId ? "estate" : undefined;
    }

    const runtime = await handleSignal(signal as Signal);

    const accepted = runtime?.receipt?.accepted !== false;
    return res.status(accepted ? 202 : 409).json({
      accepted,
      status: accepted ? "accepted" : "rejected",
      signalType: signal.type,
      runtime,
    });
  } catch (err) {
    console.error("Signal ingestion failed:", err);
    return res.status(500).json({ error: "Signal processing failed" });
  }
}
