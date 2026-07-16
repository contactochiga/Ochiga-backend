import type { Request, Response } from "express";

type RequestTimingState = {
  started_at_ns: bigint;
  stages: Map<string, number>;
};

const requestTimings = new WeakMap<Request, RequestTimingState>();

function stateFor(req: Request) {
  let state = requestTimings.get(req);
  if (!state) {
    state = { started_at_ns: process.hrtime.bigint(), stages: new Map() };
    requestTimings.set(req, state);
  }
  return state;
}

function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export function startRequestStageTiming(req: Request) {
  requestTimings.set(req, { started_at_ns: process.hrtime.bigint(), stages: new Map() });
}

export function recordRequestStage(req: Request, stage: string, durationMs: number) {
  const state = stateFor(req);
  const normalized = Math.max(0, Math.round(durationMs * 100) / 100);
  state.stages.set(stage, (state.stages.get(stage) || 0) + normalized);
}

export async function timeRequestStage<T>(req: Request, stage: string, operation: () => Promise<T>) {
  stateFor(req);
  const startedAt = process.hrtime.bigint();
  try {
    return await operation();
  } finally {
    recordRequestStage(req, stage, elapsedMs(startedAt));
  }
}

export function timeRequestStageSync<T>(req: Request, stage: string, operation: () => T) {
  stateFor(req);
  const startedAt = process.hrtime.bigint();
  try {
    return operation();
  } finally {
    recordRequestStage(req, stage, elapsedMs(startedAt));
  }
}

export function requestStageTimingSnapshot(req: Request) {
  const state = stateFor(req);
  return {
    total_ms: Math.round(elapsedMs(state.started_at_ns) * 100) / 100,
    stages: Object.fromEntries(state.stages.entries()),
  };
}

export function exposeServerTiming(req: Request, res: Response) {
  const { stages } = requestStageTimingSnapshot(req);
  const value = Object.entries(stages)
    .map(([stage, duration]) => `${stage.replace(/[^a-z0-9_.-]/gi, "_")};dur=${duration}`)
    .join(", ");
  if (value) res.setHeader("Server-Timing", value);
}
