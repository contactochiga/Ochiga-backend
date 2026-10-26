import { hardwarePaymentService } from "./hardwarePaymentRoutes";
// Invoke once per minute via a separately reviewed scheduler. Does not depend on the init switch.
async function main() {
  if (process.env.HARDWARE_PAYMENT_PROCESSING_ENABLED !== "true")
    throw Error("payment_processing_disabled");
  await hardwarePaymentService().sweep();
}
main().catch(() => {
  console.error("hardware_payment_reconciliation_failed");
  process.exitCode = 1;
});
