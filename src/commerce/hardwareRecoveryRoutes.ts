import { supabaseAdmin } from "../supabase/supabaseClient";
import { paystack } from "../utils/paystack";
import { HardwareRecovery } from "./hardwareRecovery";
async function operations(body: any) {
  const u = new URL(process.env.OFFICE_HARDWARE_FINANCIAL_URL || "");
  const key = process.env.OFFICE_HARDWARE_FINANCIAL_KEY || "";
  if (u.protocol !== "https:" || key.length < 32)
    throw Error("financial_operations_unconfigured");
  const r = await fetch(u, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("financial_operations_unavailable");
  return r.json();
}
export function hardwareRecoveryService() {
  const rpc = async (name: string, args: any) => {
    const r = await supabaseAdmin.rpc(name, args);
    if (r.error) throw Error("financial_storage_unavailable");
    return r.data;
  };
  const rows = async (query: any) => {
    const r = await query;
    if (r.error) throw Error("financial_storage_unavailable");
    return r.data || [];
  };
  return new HardwareRecovery({
    rpc,
    secret: process.env.HARDWARE_PAYSTACK_SECRET_KEY || "",
    callback: process.env.HARDWARE_PAYSTACK_CALLBACK_URL || "",
    provider: paystack,
    refundsEnabled: process.env.HARDWARE_REFUNDS_ENABLED === "true",
    get: async (reference: string) =>
      (
        await rows(
          supabaseAdmin
            .from("hardware_payment_attempts")
            .select("*")
            .eq("reference", reference),
        )
      )[0],
    due: () =>
      rows(
        supabaseAdmin
          .from("hardware_payment_attempts")
          .select("reference")
          .lte("next_attempt_at", new Date().toISOString())
          .order("next_attempt_at")
          .limit(100),
      ),
    office: async (proof: any) => {
      const u = new URL(process.env.OFFICE_HARDWARE_PAYMENT_CONFIRM_URL || ""),
        key = process.env.OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY || "";
      if (u.protocol !== "https:" || key.length < 32)
        throw Error("office_confirmation_unconfigured");
      const r = await fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(proof),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("office_confirmation_unavailable");
      return r.json();
    },
    approvals: async () =>
      (await operations({ action: "approved-refunds" })).approvals,
    refundsDue: () =>
      rows(
        supabaseAdmin
          .from("hardware_refunds")
          .select("*")
          .neq("state", "processed")
          .lte("next_attempt_at", new Date().toISOString())
          .order("next_attempt_at")
          .limit(100),
      ),
    outbox: async () => {
      const q = await rows(
        supabaseAdmin
          .from("hardware_payment_delivery_queue")
          .select(
            "event_id,hardware_payment_observations!inner(*,hardware_payment_attempts!inner(order_id,amount_kobo,environment))",
          )
          .is("delivered_at", null)
          .order("event_id")
          .limit(100),
      );
      return q.map((x: any) => {
        const o = x.hardware_payment_observations;
        return {
          event_id: x.event_id,
          reference: o.reference,
          state: o.state,
          evidence: o.evidence,
          ...o.hardware_payment_attempts,
        };
      });
    },
    deliverObservation: async (event: any) => {
      await operations({ action: "observe", event });
    },
  });
}
