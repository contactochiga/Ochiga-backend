export type ProviderErrorClassification =
  | "permission_denied"
  | "device_not_linked"
  | "integration_expired"
  | "provider_unavailable"
  | "rate_limited"
  | "authentication_failed"
  | "unknown_provider_error";

export type ProviderAuthorizationState =
  | "authorized"
  | "authorization_required"
  | "device_not_linked"
  | "unknown";

export type CanonicalProviderError = {
  provider: string;
  classification: ProviderErrorClassification;
  provider_code: string | null;
  http_status: number | null;
  safe_message: string;
  authorization_state: ProviderAuthorizationState;
  suggested_remediation: string;
  retryable: boolean;
  occurred_at: string;
  operation: string | null;
  failure_count?: number;
  next_retry_at?: string | null;
};

type ProviderErrorContext = {
  provider?: string | null;
  operation?: string | null;
  device?: Record<string, any> | null;
  occurredAt?: string;
};

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly providerCode: string | null;
  readonly providerMessage: string;
  readonly httpStatus: number | null;
  readonly operation: string | null;

  constructor(input: {
    provider: string;
    providerCode?: string | number | null;
    providerMessage: string;
    httpStatus?: number | null;
    operation?: string | null;
    cause?: unknown;
  }) {
    super(`${input.provider} request failed${input.providerCode != null ? ` (${input.providerCode})` : ""}`);
    this.name = "ProviderRequestError";
    this.provider = input.provider;
    this.providerCode = input.providerCode == null ? null : String(input.providerCode);
    this.providerMessage = input.providerMessage;
    this.httpStatus = input.httpStatus ?? null;
    this.operation = input.operation ?? null;
    if (input.cause !== undefined) (this as Error & { cause?: unknown }).cause = input.cause;
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorDetails(error: unknown) {
  const typed = error instanceof ProviderRequestError ? error : null;
  const candidate = error && typeof error === "object" ? error as Record<string, any> : {};
  const response = candidate.response && typeof candidate.response === "object" ? candidate.response : {};
  const data = response.data && typeof response.data === "object" ? response.data : {};
  return {
    provider: text(typed?.provider || candidate.provider || "tuya") || "tuya",
    code: text(typed?.providerCode || candidate.providerCode || candidate.code || data.code) || null,
    message: text(typed?.providerMessage || data.msg || data.message || candidate.message || error),
    httpStatus: typed?.httpStatus ?? (Number(response.status || candidate.status) || null),
    operation: text(typed?.operation || candidate.operation) || null,
  };
}

function deviceLooksUnlinked(device?: Record<string, any> | null) {
  const metadata = device?.metadata && typeof device.metadata === "object" ? device.metadata : {};
  const raw = metadata.raw && typeof metadata.raw === "object" ? metadata.raw : {};
  const context = metadata.context && typeof metadata.context === "object" ? metadata.context : {};
  const oyi = metadata.oyi && typeof metadata.oyi === "object" ? metadata.oyi : {};
  const externalId = text(device?.external_id);
  const oyiUuidAsProviderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(externalId);
  const hasOwnership = Boolean(
    text(oyi.integration_owner_user_id) ||
    text(context.userId) ||
    text(context.tuyaUid) ||
    text(raw.owner_id) ||
    text(metadata.owner_id),
  );
  return oyi.provider_available === false || (oyiUuidAsProviderId && !hasOwnership) || !externalId;
}

export function classifyProviderError(error: unknown, context: ProviderErrorContext = {}): CanonicalProviderError {
  const details = errorDetails(error);
  const provider = text(context.provider || details.provider) || "provider";
  const message = details.message.toLowerCase();
  const code = details.code;
  const httpStatus = details.httpStatus;
  const operation = text(context.operation || details.operation) || null;
  let classification: ProviderErrorClassification = "unknown_provider_error";

  if (code === "1106" || /permission\s*deny|not authorized to access.*device/.test(message)) {
    classification = deviceLooksUnlinked(context.device) ? "device_not_linked" : "permission_denied";
  } else if (/not linked|device.*not.*linked|not associated|not belong/.test(message)) {
    classification = "device_not_linked";
  } else if (/token.*expired|integration.*expired|access token.*invalid|relink/.test(message)) {
    classification = "integration_expired";
  } else if (httpStatus === 429 || /rate.?limit|too many requests|frequency limit/.test(message)) {
    classification = "rate_limited";
  } else if (httpStatus === 401 || code === "1004" || /sign invalid|signature|authentication|invalid credential|access.?id/.test(message)) {
    classification = "authentication_failed";
  } else if ((httpStatus != null && httpStatus >= 500) || /timeout|timed out|econn|network|temporarily unavailable|service unavailable/.test(message)) {
    classification = "provider_unavailable";
  }

  const authorizationRequired = ["permission_denied", "device_not_linked", "integration_expired", "authentication_failed"].includes(classification);
  const safeMessage = classification === "permission_denied" || classification === "device_not_linked"
    ? "This device needs its Tuya connection refreshed."
    : classification === "integration_expired"
      ? "The Tuya connection has expired and needs to be linked again."
      : classification === "authentication_failed"
        ? "The Tuya connection could not be authenticated."
        : classification === "rate_limited"
          ? "The connected device provider is busy. Oyi will retry shortly."
          : classification === "provider_unavailable"
            ? "The connected device provider is temporarily unavailable."
            : "The connected device provider could not complete this request.";
  const suggestedRemediation = classification === "device_not_linked"
    ? "Reconnect Smart Life and sync the device registry."
    : classification === "permission_denied" || classification === "integration_expired"
      ? "Refresh the Smart Life connection for the integration owner."
      : classification === "authentication_failed"
        ? "Verify the Tuya project credentials, region, and linked account."
        : classification === "rate_limited" || classification === "provider_unavailable"
          ? "Wait for the provider retry window and try again."
          : "Review the provider diagnostic trace.";

  return {
    provider,
    classification,
    provider_code: code,
    http_status: httpStatus,
    safe_message: safeMessage,
    authorization_state: classification === "device_not_linked"
      ? "device_not_linked"
      : authorizationRequired
        ? "authorization_required"
        : "unknown",
    suggested_remediation: suggestedRemediation,
    retryable: classification !== "authentication_failed",
    occurred_at: context.occurredAt || new Date().toISOString(),
    operation,
  };
}

export function isProviderAuthorizationError(error: unknown, context: ProviderErrorContext = {}) {
  return ["permission_denied", "device_not_linked", "integration_expired", "authentication_failed"]
    .includes(classifyProviderError(error, context).classification);
}
