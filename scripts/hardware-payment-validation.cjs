const assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const {
  HardwarePayments,
  paymentCallback,
  classifyHardwareProviderFailure,
} = require("../dist/commerce/hardwarePayments");
(async () => {
  let writes = 0;
  const base = {
    order_id: "11111111-1111-1111-1111-111111111111",
    reservation_id: "22222222-2222-2222-2222-222222222222",
    reference: "hwo_" + "1".repeat(32),
    amount_kobo: 500,
    currency: "NGN",
    environment: "test",
    authorization_hash: "a".repeat(64),
    email: "test@example.invalid",
  };
  const service = new HardwarePayments({
    rpc: async () => {
      writes++;
      throw Error("unexpected storage");
    },
    provider: {},
    secret: "sk_test_SYNTHETIC",
    callback: "https://getoyi.com/hardware/checkout",
  });
  const bad = [
    null,
    [],
    { ...base, amount_kobo: 0 },
    { ...base, amount_kobo: -1 },
    { ...base, amount_kobo: 1.5 },
    { ...base, amount_kobo: "500" },
    { ...base, amount_kobo: 9009999999999 },
    { ...base, currency: "USD" },
    { ...base, environment: "live" },
    { ...base, callback_url: "https://evil.example" },
    { ...base, order_id: "not-uuid" },
    { ...base, reservation_id: "not-uuid" },
    { ...base, reference: "hwo_" + "f".repeat(32) },
  ];
  for (const b of bad)
    await assert.rejects(
      () => service.initialize(b),
      /invalid_payment_authorization/,
    );
  assert.equal(writes, 0);
  assert.throws(
    () => paymentCallback("https://evil.example/hardware/checkout"),
    /invalid_callback/,
  );
  let observed;
  const d = {
    rpc: async (name, args) => {
      if (name === "hardware_payment_create")
        return { ...base, state: "created" };
      if (name === "hardware_payment_claim")
        return { ...base, state: "created", lease_token: "synthetic" };
      return {};
    },
    secret: "sk_test_DEDICATED_SYNTHETIC",
    callback: "https://getoyi.com/hardware/checkout",
    provider: {
      post: async (url, body, options) => {
        observed = options;
        return {
          data: {
            status: true,
            data: {
              reference: base.reference,
              authorization_url: "https://checkout.paystack.com/local",
            },
          },
        };
      },
    },
  };
  await new HardwarePayments(d).initialize(base);
  assert.equal(observed.headers.Authorization, "Bearer " + d.secret);
  assert.equal(observed.maxRedirects, 0);
  assert.equal(observed.timeout, 15000);
  for (const code of [
    "provider_http_4xx",
    "provider_rate_limited",
    "provider_http_5xx",
    "pre_dispatch_connection_failure",
    "post_dispatch_timeout_or_lost_response",
    "malformed_provider_response",
  ]) {
    assert.equal(
      classifyHardwareProviderFailure(Object.assign(Error("private"), { code })),
      code,
    );
  }
  assert.equal(classifyHardwareProviderFailure(Error("private")), "provider_transport_unknown");
  for (const code of [
    "provider_http_4xx",
    "provider_rate_limited",
    "provider_http_5xx",
    "pre_dispatch_connection_failure",
    "post_dispatch_timeout_or_lost_response",
    "malformed_provider_response",
  ]) {
    let uncertainDetail;
    const throwing = new HardwarePayments({
      rpc: async (name, args) => {
        if (name === "hardware_payment_create") return { ...base, state: "created" };
        if (name === "hardware_payment_claim") return { ...base, state: "created", lease_token: "synthetic" };
        if (name === "hardware_payment_record" && args.p_state === "uncertain") uncertainDetail = args.p_detail;
        return {};
      },
      secret: "sk_test_SYNTHETIC",
      callback: "https://getoyi.com/hardware/checkout",
      provider: { post: async () => { throw Object.assign(Error("secret and response body"), { code }); } },
    });
    const result = await throwing.initialize(base);
    assert.equal(result.state, "processing");
    assert.deepEqual(uncertainDetail, { reason: code });
  }
  console.log(
    "37 input/callback/provider-classification/uncertainty-persistence/dedicated-credential assertions PASS",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
