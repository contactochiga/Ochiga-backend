import crypto from "crypto";
// Dedicated hardware domain. No resident/wallet services or side effects.
export type PaymentDeps = {
  rpc: (name: string, args: any) => Promise<any>;
  get: (reference: string) => Promise<any>;
  due: () => Promise<any[]>;
  provider: any;
  office: (proof: any) => Promise<any>;
  secret: string;
  callback: string;
};
const refPattern = /^hwo_[0-9a-f]{32}$/;
const safeProviderFailureCodes = new Set([
  "provider_http_4xx",
  "provider_rate_limited",
  "provider_http_5xx",
  "pre_dispatch_connection_failure",
  "post_dispatch_timeout_or_lost_response",
  "malformed_provider_response",
  "provider_transport_unknown",
]);
export function classifyHardwareProviderFailure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && safeProviderFailureCodes.has(code)
    ? code
    : "provider_transport_unknown";
}
export function validSignature(
  raw: Buffer,
  signature: unknown,
  secret: string,
) {
  if (
    !Buffer.isBuffer(raw) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(signature) ||
    !secret
  )
    return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    crypto.createHmac("sha512", secret).update(raw).digest(),
  );
}
export function paymentCallback(value: string, testOrigin?: string) {
  if (testOrigin !== undefined) {
    // Fixed loopback rehearsal origin. Never accept a caller-supplied arbitrary hostname.
    if (testOrigin !== "https://localhost:18443" || value !== testOrigin + "/hardware/checkout") throw Error("invalid_callback_configuration");
    return value;
  }
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !["getoyi.com", "www.getoyi.com"].includes(u.hostname) ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/hardware/checkout"
  )
    throw Error("invalid_callback_configuration");
  return u.href;
}
function hosted(value: unknown) {
  const u = new URL(String(value));
  if (
    u.protocol !== "https:" ||
    u.hostname !== "checkout.paystack.com" ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("invalid_hosted_checkout");
  return u.href;
}
export class HardwarePayments {
  constructor(private d: PaymentDeps) {}
  async initialize(input: any) {
    if (
      !input ||
      Object.keys(input).some(
        (k) =>
          ![
            "reference",
            "order_id",
            "reservation_id",
            "amount_kobo",
            "currency",
            "environment",
            "authorization_hash",
            "email",
          ].includes(k),
      ) ||
      !refPattern.test(input.reference) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        input.order_id,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        input.reservation_id,
      ) ||
      input.reference !== "hwo_" + String(input.order_id).replaceAll("-", "") ||
      !Number.isSafeInteger(input.amount_kobo) ||
      input.amount_kobo < 1 ||
      input.amount_kobo > 900999999999 ||
      input.currency !== "NGN" ||
      input.environment !== "test" ||
      !/^[0-9a-f]{64}$/.test(input.authorization_hash) ||
      typeof input.email !== "string" ||
      input.email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(input.email)
    )
      throw Error("invalid_payment_authorization");
    if (!this.d.secret.startsWith("sk_test_"))
      throw Error("test_provider_required");
    paymentCallback(this.d.callback, process.env.HARDWARE_SETUP_ONLY === "true" ? process.env.HARDWARE_TEST_CALLBACK_ORIGIN : undefined);
    const { email, ...authorization } = input;
    const created = await this.d.rpc("hardware_payment_create", {
      p: authorization,
    });
    if (
      ["confirmed", "refund_required", "manual_reconciliation"].includes(
        created.state,
      )
    )
      return { state: created.state };
    if (created.state === "verified") return { state: "processing" };
    if (created.checkout_url)
      return {
        state: created.state,
        checkout_url: hosted(created.checkout_url),
      };
    const a = await this.d.rpc("hardware_payment_claim", {
      p_reference: input.reference,
    });
    if (!a) return { state: "processing" };
    try {
      // An interrupted/uncertain initialize is NEVER repeated. Verify the original reference.
      if (a.state !== "created") {
        await this.verifyClaim(a);
        return { state: "processing" };
      }
      await this.record(a, "initializing", {});
      let response: any;
      try {
        response = await this.d.provider.post(
          "/transaction/initialize",
          {
            email,
            amount: a.amount_kobo,
            currency: "NGN",
            reference: a.reference,
            callback_url: this.d.callback,
            metadata: {
              purpose: "hardware_order",
              order_id: a.order_id,
              reservation_id: a.reservation_id,
              authorization_hash: a.authorization_hash,
            },
          },
          {
            timeout: 15000,
            maxRedirects: 0,
            headers: { Authorization: `Bearer ${this.d.secret}` },
          },
        );
      } catch (error) {
        await this.record(a, "uncertain", {
          reason: classifyHardwareProviderFailure(error),
        });
        return { state: "processing" };
      }
      try {
        const r = response.data;
        if (r.status !== true || r.data?.reference !== a.reference)
          throw Error("provider_contract");
        const url = hosted(r.data.authorization_url);
        await this.record(a, "pending", { checkout_url: url });
        return { state: "pending", checkout_url: url };
      } catch {
        await this.record(a, "uncertain", {
          reason: "initialization_response_invalid",
        });
        return { state: "processing" };
      }
    } finally {
      await this.d.rpc("hardware_payment_unlock", {
        p_reference: a.reference,
        p_token: a.lease_token,
      });
    }
  }
  private record(a: any, state: string, detail: any) {
    return this.d.rpc("hardware_payment_record", {
      p_reference: a.reference,
      p_token: a.lease_token,
      p_state: state,
      p_detail: detail,
    });
  }
  private async deliver(a: any) {
    // Durable verified row is the outbox. Failure leaves it retryable, never loses payment evidence.
    let result;
    try { result = await this.d.office(a.proof); }
    catch { await this.d.rpc('hardware_payment_note',{p_reference:a.reference,p_token:a.lease_token,p_event:'office_delivery_failed'});throw Error('office_delivery_failed'); }
    if (!["paid", "refund_required"].includes(result?.payment_state))
      throw Error("office_confirmation_incomplete");
    await this.record(
      a,
      result.payment_state === "paid" ? "confirmed" : "refund_required",
      { reason: "office_acknowledged" },
    );
  }
  private async verifyClaim(a: any) {
    if (a.state === "verified") return this.deliver(a);
    let response: any;
    try {
      response = await this.d.provider.get(
        "/transaction/verify/" + encodeURIComponent(a.reference),
        {
          timeout: 15000,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${this.d.secret}` },
        },
      );
    } catch {
      await this.d.rpc('hardware_payment_note',{p_reference:a.reference,p_token:a.lease_token,p_event:'provider_verify_unavailable'});return;
    }
    const r = response.data,
      p = r?.data;
    if (r?.status !== true || !p || p.status !== "success") {
      await this.d.rpc('hardware_payment_note',{p_reference:a.reference,p_token:a.lease_token,p_event:'provider_not_successful'});return;
    }
    const m = p.metadata;
    if (
      p.reference !== a.reference ||
      !Number.isSafeInteger(p.amount) ||
      p.amount !== Number(a.amount_kobo) ||
      p.currency !== "NGN" ||
      p.domain !== a.environment ||
      !m ||
      m.purpose !== "hardware_order" ||
      m.order_id !== a.order_id ||
      m.reservation_id !== a.reservation_id ||
      m.authorization_hash !== a.authorization_hash ||
      !/^\d{1,40}$/.test(String(p.id)) ||
      (typeof p.id === "number" && !Number.isSafeInteger(p.id))
    ) {
      await this.record(a, "manual_reconciliation", {
        reason: "provider_evidence_mismatch",
        provider_id: String(p.id).slice(0, 40),
        amount_kobo: Number.isSafeInteger(p.amount) ? p.amount : null,
        currency: String(p.currency).slice(0, 8),
        environment: String(p.domain).slice(0, 12),
      });
      return;
    }
    const proof = {
      reference: a.reference,
      provider_id: String(p.id),
      order_id: a.order_id,
      reservation_id: a.reservation_id,
      amount_kobo: Number(a.amount_kobo),
      currency: "NGN",
      environment: a.environment,
      purpose: "hardware_order",
      authorization_hash: a.authorization_hash,
    };
    let saved;
    try {
      saved = await this.record(a, "verified", proof);
    } catch {
      await this.record(a, "manual_reconciliation", {
        reason: "verification_persistence_conflict",
      });
      return;
    }
    await this.deliver(saved);
  }
  async reconcile(reference: string) {
    if (!this.d.secret.startsWith("sk_test_"))
      throw Error("test_provider_required");
    if (!refPattern.test(reference)) throw Error("invalid_reference");
    const a = await this.d.rpc("hardware_payment_claim", {
      p_reference: reference,
    });
    if (!a) return;
    try {
      await this.verifyClaim(a);
    } finally {
      await this.d.rpc("hardware_payment_unlock", {
        p_reference: reference,
        p_token: a.lease_token,
      });
    }
  }
  async webhook(raw: Buffer, signature: unknown) {
    if (!this.d.secret.startsWith("sk_test_"))
      throw Error("test_provider_required");
    if (!validSignature(raw, signature, this.d.secret))
      throw Error("invalid_signature");
    const body = JSON.parse(raw.toString("utf8"));
    const reference = body?.data?.reference || body?.data?.transaction_reference || body?.data?.transaction?.reference;
    if (
      typeof reference !== "string" ||
      typeof body.event !== "string"
    )
      throw Error("invalid_event");
    await this.d.rpc("hardware_payment_accept_event", {
      p_digest: crypto.createHash("sha256").update(raw).digest("hex"),
      p_reference: reference,
      p_type: body.event,
    });
  }
  async sweep() {
    let failures = 0;
    for (const a of await this.d.due()) {
      try {
        await this.reconcile(a.reference);
      } catch {
        failures++;
      }
    }
    if (failures) throw Error("payment_reconciliation_incomplete");
  }
}
