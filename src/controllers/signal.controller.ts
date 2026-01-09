// src/controllers/signal.controller.ts
import { Request, Response } from "express";

import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { Signal } from "../core/control-plane/contracts/signal.types";

export async function ingestSignal(req: Request, res: Response) {
  try {
    const raw = req.body;

    if (!raw?.type) {
      return res.status(400).json({ error: "Invalid signal payload" });
    }

    const signal: Signal = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: raw.source ?? "user",
      type: raw.type,
      timestamp: new Date().toISOString(),
      ...raw,
    };

    await handleSignal(signal);

    return res.status(202).json({
      status: "accepted",
      signalType: signal.type,
    });
  } catch (err) {
    console.error("Signal ingestion failed:", err);
    return res.status(500).json({ error: "Signal processing failed" });
  }
}
