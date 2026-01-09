import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { Signal } from "../core/control-plane/contracts/signal.types";

export async function ingestSignal(req: Request, res: Response) {
  try {
    const body = req.body;

    if (!body?.type) {
      return res.status(400).json({ error: "Signal type is required" });
    }

    // Normalize incoming signal
    const signal: Signal = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: body.source ?? "system",
      type: body.type,
      timestamp: new Date().toISOString(),
      metadata: body.metadata,
      ...body, // allows typed fields like roomId, homeId, etc
    };

    await handleSignal(signal);

    return res.status(202).json({
      status: "accepted",
      signalType: signal.type,
    });
  } catch (err) {
    console.error("HTTP signal ingestion failed", err);
    return res.status(500).json({ error: "Failed to ingest signal" });
  }
}
