"use client";

// DO NOT EDIT FRONTEND COPIES DIRECTLY — generated from canonical Oyi Camera Core.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraPlaybackSession } from "./core";

export type CameraPlaybackStatus = "idle" | "loading" | "ready" | "refreshing" | "unavailable" | "error";
export type CameraPlaybackOptions = {
  cameraId: string | null; enabled?: boolean; autoPlay?: boolean;
  createSession: (cameraId: string) => Promise<CameraPlaybackSession>;
};

function refreshDelay(session: CameraPlaybackSession) {
  const expiry = session.expiresAt ? Date.parse(session.expiresAt) : NaN;
  return Number.isFinite(expiry) ? Math.max(5_000, expiry - Date.now() - 15_000) : 60_000;
}

export function useCameraPlayback({ cameraId, enabled = true, autoPlay = true, createSession }: CameraPlaybackOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const generation = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureCount = useRef(0);
  const [session, setSession] = useState<CameraPlaybackSession | null>(null);
  const [status, setStatus] = useState<CameraPlaybackStatus>(enabled ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);

  const clearTimers = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    refreshTimer.current = null; retryTimer.current = null;
  }, []);

  const loadSession = useCallback(async (refreshing = false) => {
    if (!enabled || !cameraId) { setStatus("idle"); setSession(null); return; }
    const current = ++generation.current; clearTimers(); setStatus(refreshing ? "refreshing" : "loading"); setError(null);
    try {
      const next = await createSession(cameraId);
      if (generation.current !== current) return;
      failureCount.current = 0; setSession(next); setStatus("ready");
      refreshTimer.current = setTimeout(() => void loadSession(true), refreshDelay(next));
    } catch (reason: any) {
      if (generation.current !== current) return;
      setSession(null); setError(String(reason?.message || "Camera playback is unavailable"));
      if (failureCount.current < 2) {
        const delay = failureCount.current === 0 ? 2_000 : 5_000; failureCount.current += 1;
        setStatus("refreshing"); retryTimer.current = setTimeout(() => void loadSession(true), delay);
      } else setStatus(reason?.response?.status === 409 ? "unavailable" : "error");
    }
  }, [cameraId, clearTimers, createSession, enabled]);

  useEffect(() => { failureCount.current = 0; void loadSession(false); return () => { generation.current += 1; clearTimers(); }; }, [loadSession, clearTimers]);

  useEffect(() => {
    let hls: any = null; let cancelled = false;
    const video = videoRef.current;
    if (!video || !session || status !== "ready") return;
    const reset = () => { try { video.pause(); video.removeAttribute("src"); video.srcObject = null; video.load(); } catch {} };
    reset();
    void (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = session.url; if (autoPlay) await video.play().catch(() => undefined); return; }
      try {
        const hlsModule = await import("hls.js"); if (cancelled) return; const Hls = hlsModule.default;
        if (!Hls.isSupported()) { setStatus("unavailable"); setError("HLS is not supported in this browser"); return; }
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
        hls.attachMedia(video); hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(session.url));
        hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => { if (data?.fatal && !cancelled) void loadSession(true); });
        if (autoPlay) await video.play().catch(() => undefined);
      } catch (reason: any) { if (!cancelled) { setStatus("error"); setError(String(reason?.message || "Failed to initialize HLS playback")); } }
    })();
    return () => { cancelled = true; try { hls?.destroy?.(); } catch {} reset(); };
  }, [autoPlay, loadSession, session, status]);

  return { videoRef, session, status, error, refresh: () => loadSession(true) };
}
