import type { AuthUser } from "../middleware/auth";
import { hasWatchScope } from "./watchPolicy";

export type TwinSource = "placeholder" | "uploaded_floorplan" | "generated_plan" | "glb" | "render";

export interface TwinProvider {
  getTwin(actor: AuthUser): Promise<Record<string, unknown>>;
}

export interface ModelProvider {
  getModel(actor: AuthUser): Promise<Record<string, unknown>>;
}

export interface RenderProvider {
  getRender(actor: AuthUser): Promise<Record<string, unknown>>;
}

function scope(actor: AuthUser) {
  if (!hasWatchScope(actor)) throw new Error("scope_required");
  return { home_id: actor.home_id || null, estate_id: actor.estate_id || null };
}

export const twinProvider: TwinProvider = {
  async getTwin(actor) {
    return {
      ...scope(actor),
      source: "placeholder" as TwinSource,
      configured: false,
      capabilities: ["uploaded_floorplan", "generated_plan", "glb", "render"],
    };
  },
};

export const modelProvider: ModelProvider = {
  async getModel(actor) {
    return { ...scope(actor), configured: false, source: null, model_url: null };
  },
};

export const renderProvider: RenderProvider = {
  async getRender(actor) {
    return { ...scope(actor), configured: false, source: null, render_url: null };
  },
};
