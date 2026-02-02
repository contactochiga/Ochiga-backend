// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) console.warn("OPENAI_API_KEY not set — /ai/chat will run in fallback mode.");

const client = apiKey ? new OpenAI({ apiKey }) : null;

type AIChatResponse = {
  reply: string;
  panel?: string | null;
  deviceId?: string | null;
};

router.post("/chat", async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};
  const devices = Array.isArray(context.devices) ? context.devices : [];

  if (!message) return res.status(400).json({ error: "message is required" });

  // ✅ Fallback if no key configured
  if (!client) {
    const fallback: AIChatResponse = {
      reply: "AI is not enabled on the backend yet (OPENAI_API_KEY missing). But your system is online ✅",
      panel: null,
      deviceId: null,
    };
    return res.json(fallback);
  }

  const system = `
You are Oyi OS assistant. Your job:
1) Reply to the user in simple terms.
2) Optionally select a UI panel from ONLY this list:
   home, rooms, visitor, door, wallet, utilities, maintenance, community, light, ac, tv, cctv, sensors, devices
3) Optionally choose a deviceId if the user references a device.

Return ONLY valid JSON like:
{
  "reply": "string",
  "panel": "devices" | null,
  "deviceId": "string" | null
}

Known devices (for mapping by name -> id):
${JSON.stringify(devices)}
  `.trim();

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    let text = resp.choices?.[0]?.message?.content?.trim() || "";
    text = text.replace(/```json|```/gi, "").trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first !== -1 && last !== -1) parsed = JSON.parse(text.slice(first, last + 1));
    }

    if (!parsed || typeof parsed.reply !== "string") {
      const safe: AIChatResponse = {
        reply: text || "Okay. What would you like to do next?",
        panel: null,
        deviceId: null,
      };
      return res.json(safe);
    }

    const out: AIChatResponse = {
      reply: parsed.reply,
      panel: parsed.panel ?? null,
      deviceId: parsed.deviceId ?? null,
    };

    return res.json(out);
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "";

    // ✅ IMPORTANT: Handle quota/rate-limit gracefully (no 500)
    if (status === 429 || /quota|rate limit/i.test(msg)) {
      const fallback: AIChatResponse = {
        reply:
          "AI is temporarily unavailable (quota/rate limit reached). You can still control devices from the panels. ✅",
        panel: null,
        deviceId: null,
      };
      return res.status(200).json(fallback);
    }

    console.error("AI chat error:", msg || err);
    return res.status(200).json({
      reply: "AI is temporarily unavailable. Please try again later.",
      panel: null,
      deviceId: null,
    } satisfies AIChatResponse);
  }
});

