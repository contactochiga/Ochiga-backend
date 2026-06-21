export type LanguageTeacherDomain =
  | "visitors"
  | "maintenance"
  | "devices"
  | "rooms"
  | "scenes"
  | "automation"
  | "services"
  | "wallet"
  | "community"
  | "activity"
  | "notifications"
  | "security"
  | "utilities"
  | "profile"
  | "cameras"
  | "infrastructure"
  | "sensors"
  | "traffic"
  | "staff"
  | "reports"
  | "estate"
  | "workflows"
  | "operational_queue"
  | "awareness"
  | "unknown";

export type LanguageTeacherIntent =
  | "awareness"
  | "investigation"
  | "device_control"
  | "device_status"
  | "visitor_operation"
  | "maintenance_operation"
  | "wallet_operation"
  | "service_operation"
  | "community_operation"
  | "notification_operation"
  | "report_generation"
  | "capability_query"
  | "recommendation"
  | "general_help";

export type LanguageTeacherProviderName = "openai" | "gemini" | "anthropic" | "groq" | "local";

export type LanguageTeacherInput = {
  phrase: string;
  surface?: string | null;
  locale?: string | null;
  context?: Record<string, unknown>;
};

export type LanguageTeacherResult = {
  domain: LanguageTeacherDomain;
  intent: LanguageTeacherIntent;
  entities: Array<{ type: string; value: string; confidence?: number }>;
  confidence: number;
  normalized_phrase: string;
  provider: LanguageTeacherProviderName;
};

export interface LanguageTeacherProvider {
  name: LanguageTeacherProviderName;
  interpret(input: LanguageTeacherInput): Promise<LanguageTeacherResult | null>;
}

function unavailableProvider(name: LanguageTeacherProviderName): LanguageTeacherProvider {
  return {
    name,
    async interpret() {
      return null;
    },
  };
}

export class OpenAIAdapter implements LanguageTeacherProvider {
  name: LanguageTeacherProviderName = "openai";
  async interpret() {
    // External providers are intentionally opt-in and never execute operations.
    return null;
  }
}

export class GeminiAdapter implements LanguageTeacherProvider {
  name: LanguageTeacherProviderName = "gemini";
  async interpret() {
    return null;
  }
}

export class AnthropicAdapter implements LanguageTeacherProvider {
  name: LanguageTeacherProviderName = "anthropic";
  async interpret() {
    return null;
  }
}

export function createProviderRegistry(localProvider: LanguageTeacherProvider) {
  const providers: Record<LanguageTeacherProviderName, LanguageTeacherProvider> = {
    openai: process.env.LANGUAGE_TEACHER_OPENAI_ENABLED === "true" ? new OpenAIAdapter() : unavailableProvider("openai"),
    gemini: process.env.LANGUAGE_TEACHER_GEMINI_ENABLED === "true" ? new GeminiAdapter() : unavailableProvider("gemini"),
    anthropic: process.env.LANGUAGE_TEACHER_ANTHROPIC_ENABLED === "true" ? new AnthropicAdapter() : unavailableProvider("anthropic"),
    groq: unavailableProvider("groq"),
    local: localProvider,
  };

  return {
    get(name?: string | null) {
      const key = String(name || process.env.LANGUAGE_TEACHER_PROVIDER || "local").toLowerCase() as LanguageTeacherProviderName;
      return providers[key] || providers.local;
    },
    list() {
      return Object.keys(providers) as LanguageTeacherProviderName[];
    },
  };
}
