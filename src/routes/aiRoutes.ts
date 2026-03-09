// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  console.warn("OPENAI_API_KEY not set — /ai/chat will run in fallback mode.");

const client = apiKey ? new OpenAI({ apiKey }) : null;

type DeviceAction =
  | { type: "device.command"; deviceId: string; command: Record<string, any> }
  | { type: "open.panel"; panel: string; deviceId?: string };

type AIChatResponse = {
  reply: string;
  panel?: string | null;
  deviceId?: string | null;
  actions?: DeviceAction[];
};

const PANELS = [
  "home",
  "rooms",
  "visitor",
  "door",
  "wallet",
  "utilities",
  "maintenance",
  "community",
  "light",
  "ac",
  "tv",
  "cctv",
  "sensors",
  "devices",
] as const;

function safeJsonExtract(text: string) {
  const cleaned = (text || "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    return null;
  }
}

function normalizeText(v: string) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCommandPayload(message: string): Record<string, any> | null {
  const t = normalizeText(message);

  const turnOn = /\b(turn on|switch on|on|open|enable|start)\b/.test(t);
  const turnOff = /\b(turn off|switch off|off|close|disable|stop)\b/.test(t);
  if (turnOn && !turnOff) return { switch: true };
  if (turnOff && !turnOn) return { switch: false };

  const temp = t.match(/\b(?:set|to)\s+(\d{1,2})\s*(?:c|degree|degrees)?\b/);
  if (temp) return { temperature: Number(temp[1]) };

  const pct = t.match(/\b(\d{1,3})\s*%/);
  if (pct) {
    const n = Math.max(0, Math.min(100, Number(pct[1])));
    return { brightness: n };
  }

  return null;
}

function inferFallbackActions(message: string, devices: any[]): DeviceAction[] {
  const payload = inferCommandPayload(message);
  if (!payload) return [];

  const text = normalizeText(message);
  const ranked: Array<{ id: string; score: number }> = devices
    .map((d: any) => {
      const id = String(d?.id || d?.deviceId || d?.external_id || "").trim();
      const name = normalizeText(String(d?.name || ""));
      const type = normalizeText(String(d?.type || ""));
      const room = normalizeText(String(d?.room || ""));
      if (!id) return null;

      let score = 0;
      if (name && text.includes(name)) score += 6;
      if (type && text.includes(type)) score += 3;
      if (room && text.includes(room)) score += 2;
      return { id, score };
    })
    .filter((x): x is { id: string; score: number } => Boolean(x))
    .sort((a: any, b: any) => b.score - a.score);

  if (!ranked.length || ranked[0].score <= 0) return [];

  return [
    {
      type: "device.command",
      deviceId: ranked[0].id,
      command: payload,
    },
  ];
}

router.post("/chat", async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};
  const devices = Array.isArray(context.devices) ? context.devices : [];

  if (!message) return res.status(400).json({ error: "message is required" });

  if (!client) {
    return res.json({
      reply:
        "AI is not enabled on the backend yet (OPENAI_API_KEY missing). But your system is online ✅",
      panel: null,
      deviceId: null,
      actions: [],
    } satisfies AIChatResponse);
  }

  const system = `
You are Oyi OS assistant.

Return ONLY valid JSON:
{
  "reply": string,
  "panel": ${PANELS.map((p) => `"${p}"`).join(" | ")} | null,
  "deviceId": string | null,
  "actions": [
     { "type": "device.command", "deviceId": string, "command": object }
   | { "type": "open.panel", "panel": ${PANELS.map((p) => `"${p}"`).join(" | ")}, "deviceId"?: string }
  ]
}

Rules:
- Reply in simple estate terms.
- If user asks to open/manage/show a section, set "panel".
- If user asks to control a device, include actions with deviceId and command.
- Use known devices below to map friendly name -> id when possible.

Known devices:
${JSON.stringify(devices)}
`.trim();

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonExtract(raw);

    if (!parsed || typeof parsed.reply !== "string") {
      return res.json({
        reply: raw || "Okay. What would you like to do next?",
        panel: null,
        deviceId: null,
        actions: [],
      } satisfies AIChatResponse);
    }

    // ✅ sanitize output
    const panel =
      parsed.panel && PANELS.includes(parsed.panel) ? parsed.panel : null;

    let actions: DeviceAction[] = Array.isArray(parsed.actions)
      ? parsed.actions
          .map((a: any) => {
            if (a?.type === "device.command" && a.deviceId && a.command) {
              return {
                type: "device.command",
                deviceId: String(a.deviceId),
                command:
                  typeof a.command === "object" && a.command
                    ? a.command
                    : {},
              } as DeviceAction;
            }
            if (a?.type === "open.panel" && a.panel && PANELS.includes(a.panel)) {
              const out: any = { type: "open.panel", panel: String(a.panel) };
              if (a.deviceId) out.deviceId = String(a.deviceId);
              return out as DeviceAction;
            }
            return null;
          })
          .filter(Boolean)
      : [];

    if (!actions.length) {
      actions = inferFallbackActions(message, devices);
    }

    const out: AIChatResponse = {
      reply: parsed.reply,
      panel,
      deviceId:
        parsed.deviceId ??
        (actions.find((a) => a.type === "device.command") as any)?.deviceId ??
        null,
      actions,
    };

    return res.json(out);
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "";

    if (status === 429 || /quota|rate limit/i.test(msg)) {
      return res.status(200).json({
        reply:
          "AI is temporarily unavailable (quota/rate limit). Panels still work ✅",
        panel: null,
        deviceId: null,
        actions: [],
      } satisfies AIChatResponse);
    }

    console.error("AI chat error:", status, msg || err);
    return res.status(200).json({
      reply: "AI is temporarily unavailable. Please try again later.",
      panel: null,
      deviceId: null,
      actions: [],
    } satisfies AIChatResponse);
  }
});

export default router;
