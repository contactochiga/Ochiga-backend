// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  console.warn("OPENAI_API_KEY not set — /ai/chat will run in fallback mode.");

const client = apiKey ? new OpenAI({ apiKey }) : null;

// Keep panel list centralized + strict
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

type Panel = (typeof PANELS)[number];

type AIAction =
  | { type: "device.command"; deviceId: string; command: Record<string, any> }
  | { type: "open.panel"; panel: Panel; deviceId?: string };

export type AIChatResponse = {
  reply: string;
  panel?: Panel | null;
  deviceId?: string | null;
  actions?: AIAction[];

  // ✅ to stop guessing; UI can ask follow-up
  needs_clarification?: boolean;
  clarification_question?: string | null;
};

function normalize(s?: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickDeviceId(devices: any[], deviceIdOrName?: string | null) {
  if (!deviceIdOrName) return null;

  // exact ID match
  const byId = devices.find((d: any) => String(d?.id || "") === deviceIdOrName);
  if (byId?.id) return String(byId.id);

  // name match
  const target = normalize(deviceIdOrName);
  const byName = devices.find((d: any) => normalize(d?.name) === target);
  if (byName?.id) return String(byName.id);

  return null;
}

function compactDevices(devices: any[]) {
  // ✅ keep context small + safe (avoid passing secret fields)
  return (devices || []).map((d: any) => ({
    id: d?.id ?? null,
    name: d?.name ?? null,
    room: d?.room_name ?? d?.room ?? null,
    type: d?.type ?? d?.category ?? null,
  }));
}

// ✅ Structured Output JSON Schema (strict)
const chatJsonSchema = {
  name: "oyi_chat_response",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },

      panel: {
        anyOf: [
          { type: "null" },
          { type: "string", enum: [...PANELS] },
        ],
      },

      deviceId: { type: ["string", "null"] },

      actions: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["device.command", "open.panel"] },

            // device.command
            deviceId: { type: ["string", "null"] },
            command: { type: ["object", "null"], additionalProperties: true },

            // open.panel
            panel: { type: ["string", "null"], enum: [...PANELS, null] },
          },
          required: ["type"],
        },
      },

      needs_clarification: { type: ["boolean", "null"] },
      clarification_question: { type: ["string", "null"] },
    },
    required: ["reply", "panel", "deviceId", "actions", "needs_clarification", "clarification_question"],
  },
  strict: true,
} as const;

router.post("/chat", async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};
  const devices = Array.isArray(context.devices) ? context.devices : [];

  if (!message) return res.status(400).json({ error: "message is required" });

  // ✅ Fallback if no key configured
  if (!client) {
    const fallback: AIChatResponse = {
      reply:
        "AI is not enabled on the backend yet (OPENAI_API_KEY missing). But your system is online ✅",
      panel: null,
      deviceId: null,
      actions: [],
      needs_clarification: false,
      clarification_question: null,
    };
    return res.json(fallback);
  }

  const system = `
You are Oyi OS assistant.

Your goals:
1) Reply to the user in simple, direct terms.
2) Choose a UI panel ONLY from this list:
   ${PANELS.join(", ")}
3) If the user mentions a specific device, set deviceId (use the provided context).
4) If the user is asking you to DO something (e.g. turn on/off, unlock, arm, open panel),
   return actions[] as well:
   - device.command: { deviceId, command }
   - open.panel: { panel, deviceId? }

Safety + correctness:
- If missing critical info (which device? which room? which action?), do NOT guess.
  Set needs_clarification=true and ask ONE short clarification question.
- Always return STRICT JSON matching the schema (no markdown, no extra keys).
`.trim();

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 450,
      response_format: {
        type: "json_schema",
        json_schema: chatJsonSchema,
      },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            message,
            context: { devices: compactDevices(devices) },
          }),
        },
      ],
    });

    const content = resp.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const safe: AIChatResponse = {
        reply: "Okay. What would you like to do next?",
        panel: null,
        deviceId: null,
        actions: [],
        needs_clarification: false,
        clarification_question: null,
      };
      return res.json(safe);
    }

    // ✅ Guaranteed valid JSON (schema-enforced)
    const parsed = JSON.parse(content) as AIChatResponse;

    // ✅ Clean + map deviceId if model gave name
    const mappedDeviceId = pickDeviceId(devices, parsed.deviceId ?? null);
    if (mappedDeviceId) parsed.deviceId = mappedDeviceId;

    // ✅ Fix actions deviceId mapping too
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    parsed.actions = actions
      .map((a: any) => {
        if (a?.type === "device.command") {
          const mapped = pickDeviceId(devices, a.deviceId ?? null);
          if (mapped) a.deviceId = mapped;
          if (!a.deviceId || !a.command) return null; // drop invalid
          return { type: "device.command", deviceId: String(a.deviceId), command: a.command } as AIAction;
        }

        if (a?.type === "open.panel") {
          if (!a.panel || !PANELS.includes(a.panel)) return null;
          const out: AIAction = { type: "open.panel", panel: a.panel as Panel };
          if (a.deviceId) {
            const mapped = pickDeviceId(devices, a.deviceId);
            if (mapped) out.deviceId = mapped;
          }
          return out;
        }

        return null;
      })
      .filter(Boolean) as AIAction[];

    // ✅ Ensure panel is valid
    if (parsed.panel && !PANELS.includes(parsed.panel)) parsed.panel = null;

    // ✅ Normalize clarification fields
    parsed.needs_clarification = !!parsed.needs_clarification;
    parsed.clarification_question = parsed.needs_clarification
      ? parsed.clarification_question || "Which device should I use?"
      : null;

    return res.json(parsed);
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "";

    // ✅ Quota/rate-limit gracefully (no 500)
    if (status === 429 || /quota|rate limit/i.test(msg)) {
      const fallback: AIChatResponse = {
        reply:
          "AI is temporarily unavailable (quota/rate limit). You can still control systems from the panels. ✅",
        panel: null,
        deviceId: null,
        actions: [],
        needs_clarification: false,
        clarification_question: null,
      };
      return res.status(200).json(fallback);
    }

    console.error("AI chat error:", msg || err);

    const fallback: AIChatResponse = {
      reply: "AI is temporarily unavailable. Please try again later.",
      panel: null,
      deviceId: null,
      actions: [],
      needs_clarification: false,
      clarification_question: null,
    };
    return res.status(200).json(fallback);
  }
});

export default router;
