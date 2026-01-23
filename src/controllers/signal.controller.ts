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

    await handleSignal(signal as Signal);

    return res.status(202).json({
      status: "accepted",
      signalType: signal.type,
    });
  } catch (err) {
    console.error("Signal ingestion failed:", err);
    return res.status(500).json({ error: "Signal processing failed" });
  }
}
