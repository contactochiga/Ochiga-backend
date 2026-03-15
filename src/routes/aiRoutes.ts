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
  | { type: "open.panel"; panel: string; deviceId?: string }
  | {
      type: "visitor.create";
      payload: {
        name?: string;
        phone?: string;
        purpose?: string;
        expires_hours?: number;
        navigation_mode?: "code" | "link";
      };
    };

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
  const wantsLight = /\b(light|lights|lamp)\b/.test(text);
  const wantsAc = /\b(ac|air con|air conditioner)\b/.test(text);
  const wantsTv = /\b(tv|television)\b/.test(text);
  const wantsFan = /\b(fan)\b/.test(text);
  const wantsDoor = /\b(door|lock|gate)\b/.test(text);
  const wantsCurtain = /\b(curtain|blind)\b/.test(text);

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
      if (wantsLight && (name.includes("light") || name.includes("switch") || type.includes("light"))) score += 3;
      if (wantsAc && (name.includes("ac") || name.includes("air") || type.includes("ac"))) score += 3;
      if (wantsTv && (name.includes("tv") || name.includes("television") || type.includes("tv"))) score += 3;
      if (wantsFan && (name.includes("fan") || type.includes("fan"))) score += 3;
      if (wantsDoor && (name.includes("door") || name.includes("lock") || type.includes("lock"))) score += 3;
      if (wantsCurtain && (name.includes("curtain") || name.includes("blind") || type.includes("curtain"))) score += 3;
      return { id, score };
    })
    .filter((x): x is { id: string; score: number } => Boolean(x))
    .sort((a: any, b: any) => b.score - a.score);

  if (!ranked.length || ranked[0].score <= 0) return [];
  const max = ranked[0].score;
  const targets = ranked.filter((r) => r.score >= Math.max(2, max - 1)).slice(0, 5);

  return targets.map((t) => ({
    type: "device.command",
    deviceId: t.id,
    command: payload,
  }));
}

function inferVisitorWorkflow(message: string): {
  reply: string;
  panel: string;
  actions: DeviceAction[];
} | null {
  const text = normalizeText(message);
  const wantsVisitor =
    /\b(create|generate|make|give|send)\b/.test(text) &&
    /\b(visitor|guest|access|entry code|gate pass)\b/.test(text);

  if (!wantsVisitor) return null;

  const phoneMatch = message.match(/(\+?\d[\d\s-]{7,}\d)/);
  const nameMatch =
    message.match(/(?:for|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/) ||
    message.match(/(?:for|to)\s+([a-z]+(?:\s+[a-z]+){0,2})/i);
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  const name = String(nameMatch?.[1] || "").trim();
  const phone = String(phoneMatch?.[1] || "").replace(/[^\d+]/g, "").trim();

  if (!name || !phone) {
    return {
      reply:
        "I can create visitor access. Tell me the visitor name and phone number, for example: create access for John Doe 08012345678 for 2pm.",
      panel: "visitor",
      actions: [{ type: "open.panel", panel: "visitor" }],
    };
  }

  let expires_hours = 6;
  if (timeMatch) {
    const hour = Number(timeMatch[1] || 0);
    const minute = Number(timeMatch[2] || 0);
    const ampm = String(timeMatch[3] || "").toLowerCase();
    let targetHour = hour % 12;
    if (ampm === "pm") targetHour += 12;
    const now = new Date();
    const target = new Date(now);
    target.setHours(targetHour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    expires_hours = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 3600000));
  }

  return {
    reply: `Creating visitor access for ${name}.`,
    panel: "visitor",
    actions: [
      {
        type: "visitor.create",
        payload: {
          name,
          phone,
          purpose: "Guest access",
          expires_hours,
          navigation_mode: "code",
        },
      },
      { type: "open.panel", panel: "visitor" },
    ],
  };
}

router.post("/chat", async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};
  const devices = Array.isArray(context.devices) ? context.devices : [];

  if (!message) return res.status(400).json({ error: "message is required" });

  const visitorWorkflow = inferVisitorWorkflow(message);
  if (visitorWorkflow) {
    return res.json({
      reply: visitorWorkflow.reply,
      panel: visitorWorkflow.panel,
      deviceId: null,
      actions: visitorWorkflow.actions,
    } satisfies AIChatResponse);
  }

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
- If user asks to create visitor or guest access, either ask for missing details or return a visitor.create action.
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
