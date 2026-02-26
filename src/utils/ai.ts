// src/utils/ai.ts
import OpenAI from "openai";
import { AutomationSchema } from "./validation";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) console.warn("OPENAI_API_KEY not set — AI features disabled");

const client = apiKey ? new OpenAI({ apiKey }) : null;

export type NLUContext = {
  devices: Array<{ id: string; name?: string; room_name?: string; type?: string }>;
  homes?: Array<{ id: string; name?: string }>;
  estates?: Array<{ id: string; name?: string }>;
};

/**
 * NOTE:
 * We keep the schema here lean and explicit.
 * Your AutomationSchema.parse(parsed) remains the final gate.
 */
const automationJsonSchema = {
  name: "automation_object",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },

      trigger: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string", enum: ["time", "device", "nlu", "location"] },

          // Optional identifiers
          home_id: { type: ["string", "null"] },
          estate_id: { type: ["string", "null"] },

          // Optional location fields
          coordinates: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
            },
            required: ["lat", "lng"],
          },

          // Optional ambiguity handling
          needs_clarification: { type: "boolean" },
          clarification_question: { type: ["string", "null"] },
        },
        required: ["type"],
      },

      action: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string", enum: ["device"] },

          // allow either id or name; we’ll map safely after
          device_id: { type: ["string", "null"] },

          command: {
            type: "object",
            additionalProperties: true,
          },

          // Optional ambiguity handling
          needs_clarification: { type: "boolean" },
          clarification_question: { type: ["string", "null"] },
        },
        required: ["type"],
      },

      metadata: {
        type: "object",
        additionalProperties: true,
      },
    },
    required: ["name", "trigger", "action", "metadata"],
  },
  strict: true,
} as const;

function normalize(s?: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickDeviceId(devices: NLUContext["devices"], device_id: string | null) {
  if (!device_id) return null;

  // exact id match first
  const byId = devices.find((d) => d.id === device_id);
  if (byId) return byId.id;

  // name match second
  const target = normalize(device_id);
  const byName = devices.find((d) => normalize(d.name) === target);
  if (byName) return byName.id;

  return null;
}

function pickHomeId(homes: NLUContext["homes"], homeIdOrName: string | null) {
  if (!homeIdOrName || !homes?.length) return null;

  const byId = homes.find((h) => h.id === homeIdOrName);
  if (byId) return byId.id;

  const target = normalize(homeIdOrName);
  const byName = homes.find((h) => normalize(h.name) === target);
  if (byName) return byName.id;

  return null;
}

function pickEstateId(estates: NLUContext["estates"], estateIdOrName: string | null) {
  if (!estateIdOrName || !estates?.length) return null;

  const byId = estates.find((e) => e.id === estateIdOrName);
  if (byId) return byId.id;

  const target = normalize(estateIdOrName);
  const byName = estates.find((e) => normalize(e.name) === target);
  if (byName) return byName.id;

  return null;
}

/**
 * Converts natural language prompt into structured automation JSON
 */
export async function nluToAutomation(prompt: string, context: NLUContext) {
  if (!client) throw new Error("AI client not configured");

  const devices = context?.devices || [];
  const homes = context?.homes || [];
  const estates = context?.estates || [];

  // ✅ Keep context compact: only send essential fields
  const compactDevices = devices.map((d) => ({
    id: d.id,
    name: d.name || null,
    room_name: d.room_name || null,
    type: d.type || null,
  }));

  const compactHomes = homes.map((h) => ({ id: h.id, name: h.name || null }));
  const compactEstates = estates.map((e) => ({ id: e.id, name: e.name || null }));

  const system = `
You convert user instructions into a STRICT JSON object that matches the provided JSON Schema.
Rules:
- Output must be valid JSON ONLY (no markdown).
- If the request is ambiguous or missing required details, set:
  needs_clarification=true and clarification_question="..."
  and keep unknown ids as null.
- Prefer selecting existing ids from the provided lists.
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 700,
    response_format: {
      type: "json_schema",
      json_schema: automationJsonSchema,
    },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          context: {
            devices: compactDevices,
            homes: compactHomes,
            estates: compactEstates,
          },
        }),
      },
    ],
  });

  const content = resp.choices?.[0]?.message?.content;
  if (!content) throw new Error("No response from AI");

  // ✅ No fence stripping, no substring hacks
  const parsed = JSON.parse(content);

  // ✅ Safe deterministic mapping (AI may output name instead of id)
  if (parsed?.action?.type === "device") {
    const mapped = pickDeviceId(devices, parsed.action.device_id ?? null);
    if (mapped) parsed.action.device_id = mapped;
  }

  if (parsed?.trigger?.home_id) {
    const mapped = pickHomeId(homes, parsed.trigger.home_id ?? null);
    if (mapped) parsed.trigger.home_id = mapped;
  }

  if (parsed?.trigger?.estate_id) {
    const mapped = pickEstateId(estates, parsed.trigger.estate_id ?? null);
    if (mapped) parsed.trigger.estate_id = mapped;
  }

  // ✅ Final validation gate (throws if invalid)
  return AutomationSchema.parse(parsed);
}
