// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) console.warn("OPENAI_API_KEY not set — /ai/chat will run in fallback mode.");
const client = apiKey ? new OpenAI({ apiKey }) : null;

type AIChatResponse = {
  reply: string;
  panel?: string | null;
  roomId?: string | null;
  deviceId?: string | null;
  command?: Record<string, any> | null;
};

// ✅ simple local intent parser (fast + reliable)
function parseLocalIntent(message: string): {
  action?: "on" | "off";
  roomHint?: string;
  deviceHint?: string;
} {
  const m = message.toLowerCase();

  const action =
    m.includes("turn on") || m.includes("switch on") || m.includes("on ")
      ? "on"
      : m.includes("turn off") || m.includes("switch off") || m.includes("off ")
      ? "off"
      : undefined;

  // rough room hint
  const roomWords = ["bedroom", "living", "kitchen", "bathroom", "garage", "office"];
  const roomHint = roomWords.find((r) => m.includes(r));

  // rough device hint (you can expand)
  const deviceWords = ["light", "ac", "tv", "socket", "plug", "switch", "fan"];
  const deviceHint = deviceWords.find((d) => m.includes(d));

  return { action, roomHint, deviceHint };
}

/**
 * POST /ai/chat
 * body: { message: string }
 *
 * ✅ New behavior:
 * - if user asks "turn on bedroom light"
 *   we resolve room + device from DB and return deviceId + command
 */
router.post("/chat", async (req, res) => {
  try {
    const user: any = (req as any).user; // if you mount requireAuth on /ai routes later
    const message: string = (req.body?.message || req.body?.prompt || "").trim();
    if (!message) return res.status(400).json({ error: "message is required" });

    // If we have a logged in user in middleware, use home_id for DB resolution
    const homeId = user?.home_id || req.body?.homeId || null;

    // 1) Fast local resolve for operational commands
    const local = parseLocalIntent(message);

    if (homeId && local.action && local.roomHint) {
      // Resolve room
      const { data: rooms, error: roomsErr } = await supabaseAdmin
        .from("rooms")
        .select("id,name,type")
        .eq("home_id", homeId)
        .ilike("name", `%${local.roomHint}%`)
        .limit(3);

      if (!roomsErr && rooms && rooms.length > 0) {
        const room = rooms[0];

        // Resolve device in that room
        const { data: devices, error: devErr } = await supabaseAdmin
          .from("devices")
          .select("id,external_id,name,type,room_id,vendor")
          .eq("home_id", homeId)
          .eq("room_id", room.id)
          .order("created_at", { ascending: true });

        if (!devErr && devices && devices.length > 0) {
          // crude device match by hint
          const picked =
            (local.deviceHint
              ? devices.find((d) =>
                  `${d.name || ""} ${d.type || ""}`.toLowerCase().includes(local.deviceHint!)
                )
              : null) || devices[0];

          // generic command default (you’ll tune per device type later)
          const command = { switch_1: local.action === "on" };

          const out: AIChatResponse = {
            reply: `Okay — ${local.action === "on" ? "turning on" : "turning off"} ${picked.name || "device"} in ${room.name}.`,
            panel: "rooms",
            roomId: room.id,
            deviceId: picked.external_id || picked.id,
            command,
          };

          // OPTIONAL: auto queue command (OFF by default)
          const AUTO_EXECUTE = String(process.env.AI_AUTO_EXECUTE || "").toLowerCase() === "true";
          if (AUTO_EXECUTE && user?.id) {
            await handleSignal({
              schemaVersion: SIGNAL_SCHEMA_VERSION,
              source: "ai",
              type: "device.command.requested",
              timestamp: new Date().toISOString(),
              deviceId: picked.id,
              externalDeviceId: picked.external_id,
              vendor: picked.vendor || "tuya",
              command,
              requestedBy: { userId: user.id, role: user.role },
              context: { homeId, roomId: room.id },
            } as any);

            out.reply += " ✅";
          } else {
            out.reply += " (ready)";
          }

          return res.json(out);
        }
      }
    }

    // 2) If no local operational intent, use OpenAI for general chat/panel selection
    if (!client) {
      const fallback: AIChatResponse = {
        reply: "AI is not enabled yet (OPENAI_API_KEY missing/invalid). But your system is online ✅",
        panel: null,
        roomId: null,
        deviceId: null,
        command: null,
      };
      return res.json(fallback);
    }

    const system = `
You are Oyi OS assistant.

Return ONLY valid JSON:
{
  "reply": "string",
  "panel": "home" | "rooms" | "visitor" | "door" | "wallet" | "utilities" | "maintenance" | "community" | "light" | "ac" | "tv" | "cctv" | "sensors" | "devices" | null
}
`.trim();

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 350,
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
      return res.json({
        reply: text || "Okay. What would you like to do next?",
        panel: null,
      } satisfies AIChatResponse);
    }

    return res.json({
      reply: parsed.reply,
      panel: parsed.panel ?? null,
      roomId: null,
      deviceId: null,
      command: null,
    } satisfies AIChatResponse);
  } catch (err: any) {
    console.error("AI chat error:", err?.message || err);
    return res.status(500).json({ error: "AI chat failed" });
  }
});

export default router;
