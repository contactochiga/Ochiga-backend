const assert = require("node:assert/strict"),
  express = require("express");
const {
  rejectHardwareWalletReference,
} = require("../dist/commerce/hardwarePaymentBoundary");
(async () => {
  let walletCalls = 0;
  const app = express();
  app.use(express.json());
  app.use("/wallets", rejectHardwareWalletReference);
  app.all("/wallets/*", (req, res) => {
    walletCalls++;
    res.json({ legacy: true });
  });
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    for (const suffix of [
      "/verify/hwo_abc",
      "/verify/%68wo_abc",
      "/verify?reference=hwo_abc",
      "/payment-status/hwo_abc",
      "/receipts/hwo_abc",
    ]) {
      const r = await fetch(base + "/wallets" + suffix);
      assert.equal(r.status, 400);
    }
    let r = await fetch(base + "/wallets/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: "hwo_abc" }),
    });
    assert.equal(r.status, 400);
    assert.equal(walletCalls, 0);
    r = await fetch(base + "/wallets/verify/legacy-provider-ref");
    assert.equal(r.status, 200);
    assert.equal(walletCalls, 1);
    console.log("9 actual HTTP wallet-boundary assertions PASS");
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
