import { HardwarePayments, PaymentDeps } from "./hardwarePayments";
// Provider evidence is fetched server-side. Webhooks are hints, never final financial facts.
export type RecoveryDeps = PaymentDeps & {
  refundsEnabled: boolean;
  approvals: () => Promise<any[]>;
  refundsDue: () => Promise<any[]>;
  outbox: () => Promise<any[]>;
  deliverObservation: (event: any) => Promise<void>;
};
export class HardwareRecovery {
  constructor(private d: RecoveryDeps) {}
  private options() {
    if (!this.d.secret.startsWith("sk_test_"))
      throw Error("test_provider_required");
    return {
      timeout: 15000,
      maxRedirects: 0,
      headers: { Authorization: `Bearer ${this.d.secret}` },
    };
  }
  private observe(reference: string, state: string, evidence: any) {
    return this.d.rpc("hardware_recovery_observe", {
      p_reference: reference,
      p_state: state,
      p_evidence: evidence,
    });
  }
  async reconcile(reference: string) {
    this.options();
    // Existing transactional confirmation/stock allocation remains the sole payment authority.
    try {
      await new HardwarePayments(this.d).reconcile(reference);
    } catch (e) {
      if ((e as Error).message === "office_delivery_failed") {
        await this.observe(reference, "office_retry", {
          reason: "verified_payment_awaiting_office",
        });
        return;
      }
      throw e;
    }
    const a = await this.d.rpc("hardware_recovery_claim", {
      p_reference: reference,
    });
    if (!a) return;
    try {
      let p: any;
      try {
        const r = await this.d.provider.get(
          "/transaction/verify/" + encodeURIComponent(reference),
          this.options(),
        );
        if (r.data?.status !== true) throw Error();
        p = r.data.data;
      } catch {
        await this.observe(reference, "provider_unavailable", {
          reason: "verification_unavailable",
        });
        return;
      }
      if (
        !p ||
        p.reference !== reference ||
        p.domain !== "test" ||
        p.currency !== "NGN" ||
        !Number.isSafeInteger(p.amount) ||
        p.amount !== Number(a.amount_kobo) ||
        String(p.id) !== String(a.provider_id || p.id) ||
        p.metadata?.order_id !== a.order_id ||
        p.metadata?.authorization_hash !== a.authorization_hash ||
        p.metadata?.reservation_id !== a.reservation_id ||
        p.metadata?.purpose !== "hardware_order"
      ) {
        await this.observe(reference, "amount_mismatch", {
          reason: "provider_evidence_mismatch",
        });
        return;
      }
      const state =
        p.status === "success"
          ? "provider_success"
          : p.status === "failed" || p.status === "abandoned"
            ? "provider_failed"
            : p.status === "reversed"
              ? "reversed_unreconciled"
              : Date.now() - Date.parse(a.created_at) > 30 * 60 * 1000
                ? "pending_overdue"
                : "provider_pending";
      await this.observe(reference, state, {
        provider_id: String(p.id),
        status: p.status,
        amount_kobo: p.amount,
        currency: p.currency,
        environment: p.domain,
      });
      // Paystack disputes are independently polled; a success redirect or webhook cannot clear one.
      if (a.provider_id) {
        try {
          const r = await this.d.provider.get(
            "/dispute/transaction/" + encodeURIComponent(a.provider_id),
            this.options(),
          );
          if (r.data?.status !== true) throw Error();
          if (r.data.data && !Array.isArray(r.data.data)) {
            await this.observe(reference, "disputed", {
              reason: "provider_dispute_requires_review",
            });
            return;
          }
          if (!Array.isArray(r.data.data)) throw Error();
          if (r.data.data.length)
            await this.observe(reference, "disputed", {
              reason: "provider_dispute_requires_review",
            });
        } catch {
          await this.observe(reference, "dispute_review", {
            reason: "dispute_status_unavailable",
          });
        }
      }
    } finally {
      await this.d.rpc("hardware_recovery_release", {
        p_reference: reference,
        p_token: a.lease_token,
      });
    }
  }
  async refund(approval: any) {
    this.options();
    if (!this.d.refundsEnabled) throw Error("refund_initiation_disabled");
    const created = await this.d.rpc("hardware_refund_create", { p: approval });
    const r = await this.d.rpc("hardware_refund_claim", {
      p_id: created.approval_id,
    });
    if (!r) return;
    const record = (state: string, evidence: any) =>
      this.d.rpc("hardware_refund_record", {
        p_id: r.approval_id,
        p_token: r.lease_token,
        p_state: state,
        p_evidence: evidence,
      });
    try {
      const a = await this.d.get(r.reference),
        marker = "hardware-refund:" + r.approval_id;
      let result: any;
      if (r.state === "approved") {
        const v = await this.d.provider.get(
          "/transaction/verify/" + encodeURIComponent(r.reference),
          this.options(),
        );
        const p = v.data?.data;
        if (
          v.data?.status !== true ||
          p?.status !== "success" ||
          p.domain !== "test" ||
          p.currency !== "NGN" ||
          p.amount !== Number(r.amount_kobo) ||
          p.reference !== r.reference ||
          String(p.id) !== a.provider_id
        ) {
          await record("escalated", { reason: "payment_not_refundable" });
          return;
        }
        const disputes = await this.d.provider.get(
          "/dispute/transaction/" + encodeURIComponent(a.provider_id),
          this.options(),
        );
        if (
          disputes.data?.status !== true ||
          !Array.isArray(disputes.data.data) ||
          disputes.data.data.length
        ) {
          await record("escalated", { reason: "dispute_review_required" });
          return;
        }
        // Persist intent BEFORE the external side effect. No blind retry after a crash or timeout.
        await record("dispatching", { reason: "provider_request_started" });
        try {
          const response = await this.d.provider.post(
            "/refund",
            {
              transaction: r.reference,
              amount: Number(r.amount_kobo),
              currency: "NGN",
              merchant_note: marker,
            },
            this.options(),
          );
          if (response.data?.status !== true) throw Error();
          result = response.data.data;
        } catch {
          await record("uncertain", { reason: "provider_outcome_unknown" });
          return;
        }
      } else if (r.provider_refund_id) {
        const response = await this.d.provider.get(
          "/refund/" + encodeURIComponent(r.provider_refund_id),
          this.options(),
        );
        if (response.data?.status !== true)
          throw Error("refund_verify_unavailable");
        result = response.data.data;
      } else {
        // Only recovery reads; Paystack does not document a generic idempotency key for refund creation.
        const matches: any[] = [];
        for (let page = 1; page <= 10; page++) {
          const response = await this.d.provider.get(
            "/refund?transaction=" +
              encodeURIComponent(a.provider_id) +
              "&perPage=100&page=" +
              page,
            this.options(),
          );
          if (
            response.data?.status !== true ||
            !Array.isArray(response.data.data)
          )
            throw Error("refund_verify_unavailable");
          matches.push(
            ...response.data.data.filter(
              (x: any) => x.merchant_note === marker,
            ),
          );
          if (response.data.data.length < 100) break;
          if (page === 10) {
            await record("escalated", { reason: "refund_search_limit" });
            return;
          }
        }
        if (matches.length !== 1) {
          await record(matches.length ? "escalated" : "uncertain", {
            reason: matches.length
              ? "multiple_refunds"
              : "refund_not_yet_found",
          });
          return;
        }
        result = matches[0];
      }
      const transactionId =
        typeof result?.transaction === "object"
          ? result.transaction?.id
          : result?.transaction;
      if (
        !result ||
        result.domain !== "test" ||
        result.currency !== "NGN" ||
        !Number.isSafeInteger(result.amount) ||
        result.amount !== Number(r.amount_kobo) ||
        String(transactionId) !== a.provider_id ||
        !/^\d+$/.test(String(result.id)) ||
        (typeof result.id === "number" && !Number.isSafeInteger(result.id))
      ) {
        await record("escalated", { reason: "partial_or_mismatched_refund" });
        return;
      }
      const evidence = {
        refund_id: String(result.id),
        transaction_id: String(transactionId),
        amount_kobo: result.amount,
        currency: "NGN",
        environment: "test",
        status: result.status,
      };
      await record(
        result.status === "processed"
          ? "processed"
          : ["pending", "processing"].includes(result.status)
            ? "pending"
            : "escalated",
        evidence,
      );
    } finally {
      await this.d.rpc("hardware_refund_release", {
        p_id: r.approval_id,
        p_token: r.lease_token,
      });
    }
  }
  async sweep() {
    let failures = 0;
    for (const a of await this.d.due())
      try {
        await this.reconcile(a.reference);
      } catch {
        failures++;
      }
    if (this.d.refundsEnabled) {
      const all = [
        ...(await this.d.approvals()),
        ...(await this.d.refundsDue()),
      ];
      const ids = new Set<string>();
      for (const a of all) {
        if (ids.has(a.approval_id)) continue;
        ids.add(a.approval_id);
        try {
          await this.refund(a);
        } catch {
          failures++;
        }
      }
    }
    for (const event of await this.d.outbox())
      try {
        await this.d.deliverObservation(event);
        await this.d.rpc("hardware_recovery_ack", { p_id: event.event_id });
      } catch {
        failures++;
      }
    if (failures) throw Error("financial_recovery_incomplete");
  }
}
