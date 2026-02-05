// src/services/hlsStreamManager.ts
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

type StreamProc = {
  proc: ChildProcessWithoutNullStreams;
  dir: string;
  lastUsedAt: number;
};

const streams = new Map<string, StreamProc>();

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function now() {
  return Date.now();
}

// auto cleanup old streams
setInterval(() => {
  const ttlMs = 2 * 60 * 1000; // 2 minutes idle -> kill
  for (const [key, s] of streams.entries()) {
    if (now() - s.lastUsedAt > ttlMs) {
      try { s.proc.kill("SIGKILL"); } catch {}
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
      streams.delete(key);
    }
  }
}, 30_000);

export function touchStream(key: string) {
  const s = streams.get(key);
  if (s) s.lastUsedAt = now();
}

export function getHlsDir(key: string) {
  const s = streams.get(key);
  return s?.dir || null;
}

export function startHlsStream(key: string, rtspUrl: string) {
  const existing = streams.get(key);
  if (existing) {
    existing.lastUsedAt = now();
    return existing.dir;
  }

  const dir = path.join(os.tmpdir(), "ochiga_hls", key);
  ensureDir(dir);

  const playlist = path.join(dir, "index.m3u8");

  // ffmpeg: RTSP -> HLS (low-latency-ish)
  const args = [
    "-rtsp_transport", "tcp",
    "-i", rtspUrl,

    // encode to h264/aac for browser compatibility
    "-an",                    // disable audio for now (simpler)
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-g", "50",
    "-keyint_min", "50",
    "-sc_threshold", "0",

    // hls
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list",
    "-hls_segment_filename", path.join(dir, "seg_%03d.ts"),
    playlist,
  ];

  const proc = spawn("ffmpeg", args, { stdio: "pipe" });

  proc.stderr.on("data", (d) => {
    // uncomment if you want logs:
    // console.log(`[ffmpeg ${key}]`, String(d));
  });

  proc.on("exit", () => {
    streams.delete(key);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  streams.set(key, { proc, dir, lastUsedAt: now() });
  return dir;
}
