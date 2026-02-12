// src/app/devices/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ConsumerShell from "@/app/components/ConsumerShell";
import useAuth from "@/hooks/useAuth";
import { deviceService } from "@/services/deviceService";
import GangRingSwitch from "@/app/components/devices/GangRingSwitch";

type AnyDevice = Record<string, any>;

function pickId(d: AnyDevice) {
  return d.device_id || d.devId || d.external_id || d.externalId || d.id || d.uuid || null;
}

function pickName(d: AnyDevice) {
  return d.name || d.local_name || d.localName || d.alias || "Unnamed Device";
}

function pickVendor(d: AnyDevice) {
  return d.vendor || d.adapter || d.protocol || d.brand || "device";
}

function isOnline(d: AnyDevice): boolean | null {
  if (typeof d.online === "boolean") return d.online;
  if (typeof d.isOnline === "boolean") return d.isOnline;
  if (typeof d.connected === "boolean") return d.connected;
  return null;
}

function statusDot(online: boolean | null) {
  if (online === null) return "bg-white/20";
  return online ? "bg-emerald-500" : "bg-white/25";
}

function prettyState(state: any) {
  try {
    return JSON.stringify(state ?? {}, null, 2);
  } catch {
    return String(state ?? "");
  }
}

function guessIsOn(state: any): boolean | null {
  if (!state) return null;

  if (typeof state.on === "boolean") return state.on;
  if (typeof state.power === "boolean") return state.power;
  if (typeof state.switch === "boolean") return state.switch;

  const dps = state.dps || state?.raw?.dps || null;
  if (dps && typeof dps === "object") {
    const candidates = ["1", "switch", "switch_1", "power"];
    for (const k of candidates) {
      if (typeof dps[k] === "boolean") return dps[k];
    }
  }

  return null;
}

function guessGangCount(device: AnyDevice, state: any): 1 | 2 | 3 {
  const raw = (device?.metadata?.raw ?? device?.metadata ?? device?.meta ?? {}) as any;

  const rawKeys = Object.keys(raw || {});
  const has2 = rawKeys.some((k) => k === "switch_2" || k === "switch_2_code");
  const has3 = rawKeys.some((k) => k === "switch_3" || k === "switch_3_code");
  if (has3) return 3;
  if (has2) return 2;

  const keys = Object.keys(state || {});
  if (keys.includes("switch_3")) return 3;
  if (keys.includes("switch_2")) return 2;

  const dps = state?.dps || state?.raw?.dps;
  if (dps && typeof dps === "object") {
    const dpKeys = Object.keys(dps);
    if (dpKeys.some((k) => String(k).includes("switch_3"))) return 3;
    if (dpKeys.some((k) => String(k).includes("switch_2"))) return 2;
  }

  return 1;
}

function readGangValues(gangCount: 1 | 2 | 3, state: any): Array<boolean | null> {
  const out: Array<boolean | null> = [];

  for (let i = 1; i <= gangCount; i++) {
    const k = `switch_${i}`;
    const v = state?.[k];
    out.push(typeof v === "boolean" ? v : null);
  }

  if (gangCount === 1 && out[0] === null) {
    const v = state?.switch ?? state?.power ?? state?.on;
    if (typeof v === "boolean") out[0] = v;
  }

  return out;
}

export default function DevicesPage() {
  const { user } = useAuth();

  const estateId = useMemo(
    () =>
      (user as any)?.estate_id ??
      (typeof window !== "undefined" ? localStorage.getItem("ochiga_estate") : null),
    [user]
  );

  const [items, setItems] = useState<AnyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // state modal
  const [stateOpen, setStateOpen] = useState(false);
  const [stateTitle, setStateTitle] = useState<string>("Device");
  const [stateMeta, setStateMeta] = useState<{ id?: string; vendor?: string } | null>(null);
  const [stateBody, setStateBody] = useState<string>("{}");
  const [stateLoading, setStateLoading] = useState(false);

  // local on/off cache
  const [onMap, setOnMap] = useState<Record<string, boolean | null>>({});

  // lightweight per-device state cache (so rings can show something after "Details" is opened)
  const [stateMap, setStateMap] = useState<Record<string, any>>({});

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const list = await deviceService.getDevices(estateId || undefined);
      const arr = Array.isArray(list) ? list : [];
      setItems(arr);

      const next: Record<string, boolean | null> = {};
      for (const d of arr) {
        const id = pickId(d);
        if (!id) continue;

        const listOn =
          typeof d.on === "boolean"
            ? d.on
            : typeof d.power === "boolean"
            ? d.power
            : typeof d.switch === "boolean"
            ? d.switch
            : null;

        if (listOn !== null) next[String(id)] = listOn;
      }
      if (Object.keys(next).length) setOnMap((prev) => ({ ...prev, ...next }));
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load devices");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estateId]);

  async function viewState(device: AnyDevice) {
    const id = pickId(device);
    if (!id) return;

    const sid = String(id);

    setStateTitle(pickName(device));
    setStateMeta({ id: sid, vendor: pickVendor(device) });
    setStateBody("{}");
    setStateOpen(true);
    setStateLoading(true);

    try {
      const res = await deviceService.getDeviceState(sid);
      const state = res?.state ?? res ?? {};
      setStateBody(prettyState(state));

      // cache it for rings
      setStateMap((p) => ({ ...p, [sid]: state }));

      const guessed = guessIsOn(state);
      if (guessed !== null) setOnMap((p) => ({ ...p, [sid]: guessed }));
    } catch (e: any) {
      setStateBody(
        prettyState({
          error: e?.response?.data?.error || e?.message || "Failed to load device state",
        })
      );
    } finally {
      setStateLoading(false);
    }
  }

  async function toggleGang(device: AnyDevice, gangIndex: number, next: boolean) {
    const id = pickId(device);
    if (!id) return;

    const sid = String(id);
    setBusyId(sid);
    setErr(null);

    try {
      const cached = stateMap[sid] || {};
      const gangCount = guessGangCount(device, cached);

      // multi-gang -> switch_1/2/3, single -> "switch"
      const code = gangCount === 1 ? "switch" : `switch_${gangIndex + 1}`;

      await deviceService.commandDevice(sid, { [code]: next });

      // optimistic update local cache (so ring flips instantly)
      setStateMap((p) => {
        const prev = p[sid] || {};
        if (gangCount === 1) return { ...p, [sid]: { ...prev, switch: next, power: next, on: next } };
        return { ...p, [sid]: { ...prev, [`switch_${gangIndex + 1}`]: next } };
      });

      // also update onMap (used elsewhere)
      setOnMap((p) => ({ ...p, [sid]: next }));
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Command failed (device may be offline)");
    } finally {
      setBusyId(null);
    }
  }

  function copy(text?: string | null) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
    } catch {}
  }

  const title = estateId ? "Devices" : "Devices (Discovery)";
  const subtitle = estateId ? "Estate device registry" : "Scanning devices available to connect";

  return (
    <ConsumerShell title={title} subtitle={subtitle} showBack backHref="/home">
      {/* top row */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-3">
        <div className="text-xs text-white/45 truncate">
          {estateId ? `Estate linked` : "No estate linked • using discovery"}
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="rounded-2xl px-3 py-2 text-sm bg-white text-black hover:opacity-90 disabled:opacity-50 transition"
          type="button"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      {/* list */}
      {loading && items.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 text-sm text-white/60">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          Loading devices…
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-white/60">
          No devices found yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((d) => {
            const id = pickId(d);
            const name = pickName(d);
            const vendor = pickVendor(d);
            const online = isOnline(d);

            const sid = id ? String(id) : "";
            const isBusy = !!sid && busyId === sid;

            const cachedState = sid ? stateMap[sid] : {};
            const gangCount = guessGangCount(d, cachedState);

            // if we don't have cachedState yet, fall back to onMap for single-gang
            const ringValues =
              Object.keys(cachedState || {}).length > 0
                ? readGangValues(gangCount, cachedState)
                : gangCount === 1
                ? [onMap[sid] ?? null]
                : Array.from({ length: gangCount }, () => null);

            return (
              <div
                key={String(id || name)}
                className="rounded-3xl border border-white/10 bg-white/5 hover:bg-white/7 transition p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${statusDot(online)}`} aria-hidden="true" />
                      <div className="text-sm text-white font-medium truncate">{name}</div>
                    </div>

                    <div className="text-xs text-white/40 mt-1 truncate">
                      {vendor}
                      {online === null ? "" : online ? " • online" : " • offline"}
                      {gangCount > 1 ? ` • ${gangCount}-gang` : ""}
                    </div>

                    {Array.isArray(d.capabilities) && d.capabilities.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {d.capabilities.slice(0, 6).map((c: any) => (
                          <span
                            key={String(c)}
                            className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-black/20 text-white/60"
                          >
                            {String(c)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* details */}
                    <button
                      onClick={() => viewState(d)}
                      className="rounded-2xl px-3 py-2 text-sm bg-white/10 text-white hover:bg-white/15 border border-white/10 transition"
                      type="button"
                    >
                      Details
                    </button>

                    {/* rings */}
                    <GangRingSwitch
                      gangCount={gangCount}
                      online={online}
                      values={ringValues}
                      busy={isBusy}
                      onToggleGang={(gangIndex, next) => toggleGang(d, gangIndex, next)}
                      size={54}
                    />
                  </div>
                </div>

                {id ? (
                  <div className="mt-3 text-[11px] text-white/35">
                    Device ID hidden (view in Details)
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* STATE MODAL */}
      {stateOpen && (
        <div className="fixed inset-0 z-[120]">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setStateOpen(false)}
          />
          <div className="absolute left-0 right-0 top-20 px-4">
            <div className="max-w-3xl mx-auto">
              <div className="rounded-3xl border border-white/10 bg-zinc-950 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{stateTitle}</div>
                    <div className="text-xs text-white/40 mt-1 truncate">
                      {stateMeta?.vendor ? `${stateMeta.vendor} • ` : ""}Live state snapshot
                    </div>

                    {stateMeta?.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-white/35">ID:</span>
                        <span className="text-[11px] text-white/70 font-mono truncate">{stateMeta.id}</span>
                        <button
                          onClick={() => copy(stateMeta.id)}
                          className="text-[11px] text-white/60 hover:text-white underline"
                          type="button"
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <button
                    className="rounded-xl px-2 py-1 text-white/70 hover:bg-white/5"
                    onClick={() => setStateOpen(false)}
                    aria-label="Close"
                    type="button"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-4">
                  {stateLoading ? (
                    <div className="flex items-center gap-3 text-sm text-white/60">
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Fetching state…
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={() => copy(stateBody)}
                          className="rounded-2xl px-3 py-2 text-sm bg-white/10 text-white hover:bg-white/15 border border-white/10 transition"
                          type="button"
                        >
                          Copy JSON
                        </button>
                      </div>

                      <pre className="text-xs text-white/80 whitespace-pre-wrap break-words font-mono">
                        {stateBody}
                      </pre>
                    </>
                  )}
                </div>

                <div className="px-4 py-3 border-t border-white/10 text-[11px] text-white/40">
                  Source: <span className="text-white/70">GET /devices/:deviceId/state</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConsumerShell>
  );
}
