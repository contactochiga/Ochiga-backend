// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
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

const PANEL_ENUM = [
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
Return JSON ONLY that matches the schema.

Rules:
- reply: short + direct.
- panel: must be one of: ${PANEL_ENUM.join(", ")} or null
- actions (optional):
  - device.command: include deviceId and commandJson (stringified JSON)
  - open.panel: include panel and optional deviceId
Known devices:
${JSON.stringify(devices)}
`.trim();

  try {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
      temperature: 0.2,
      max_output_tokens: 400,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "oyi_chat_response",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              reply: { type: "string" },
              panel: {
                anyOf: [
                  { type: "string", enum: [...PANEL_ENUM] },
                  { type: "null" },
                ],
              },
              deviceId: { anyOf: [{ type: "string" }, { type: "null" }] },
              actions: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            type: { type: "string", enum: ["device.command"] },
                            deviceId: { type: "string" },
                            commandJson: { type: "string" }, // ✅ dynamic command lives here
                          },
                          required: ["type", "deviceId", "commandJson"],
                        },
                        {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            type: { type: "string", enum: ["open.panel"] },
                            panel: { type: "string", enum: [...PANEL_ENUM] },
                            deviceId: { type: "string" },
                          },
                          required: ["type", "panel"],
                        },
                      ],
                    },
                  },
                ],
              },
            },
            required: ["reply", "panel", "deviceId"],
          },
        },
      },
    });

    const text = resp.output_text?.trim() || "";
    const parsed = JSON.parse(text);

    // ✅ normalize actions: parse commandJson → command object
    const actions: DeviceAction[] = Array.isArray(parsed.actions)
      ? parsed.actions
          .map((a: any) => {
            if (a?.type === "device.command") {
              let cmd: any = {};
              try {
                cmd = JSON.parse(String(a.commandJson || "{}"));
              } catch {
                cmd = {};
              }
              return { type: "device.command", deviceId: String(a.deviceId), command: cmd };
            }
            if (a?.type === "open.panel") {
              const out: any = { type: "open.panel", panel: String(a.panel) };
              if (a.deviceId) out.deviceId = String(a.deviceId);
              return out;
            }
            return null;
          })
          .filter(Boolean)
      : [];

    const out: AIChatResponse = {
      reply: String(parsed.reply || "Okay. What would you like to do next?"),
      panel: parsed.panel ?? null,
      deviceId: parsed.deviceId ?? null,
      actions,
    };

    return res.json(out);
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "";
    console.error("AI chat error:", status, msg);

    return res.status(200).json({
      reply: "AI is temporarily unavailable. Please try again later.",
      panel: null,
      deviceId: null,
      actions: [],
    } satisfies AIChatResponse);
  }
});

export default router;
