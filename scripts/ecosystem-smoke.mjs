import axios from "axios";

const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const FACILITY_TOKEN = String(process.env.FACILITY_TOKEN || "").trim();
const RESIDENT_TOKEN = String(process.env.RESIDENT_TOKEN || "").trim();
const HOME_ID = String(process.env.HOME_ID || "").trim();
const RESIDENT_EMAIL = String(process.env.RESIDENT_EMAIL || "").trim().toLowerCase();
const CREATE_TEST_MAINTENANCE = String(process.env.CREATE_TEST_MAINTENANCE || "0") === "1";
const CREATE_TEST_INVITE = String(process.env.CREATE_TEST_INVITE || "0") === "1";
const CREATE_TEST_SERVICE_PAYMENT = String(process.env.CREATE_TEST_SERVICE_PAYMENT || "0") === "1";
const SERVICE_TEST_AMOUNT = Number(process.env.SERVICE_TEST_AMOUNT || 100);

if (!FACILITY_TOKEN || !RESIDENT_TOKEN) {
  console.error("Missing FACILITY_TOKEN or RESIDENT_TOKEN");
  process.exit(1);
}

function http(token) {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

const facility = http(FACILITY_TOKEN);
const resident = http(RESIDENT_TOKEN);

const checks = [];
function ok(name, details = "") {
  checks.push({ name, status: "PASS", details });
}
function fail(name, details = "") {
  checks.push({ name, status: "FAIL", details });
}

async function runCheck(name, fn) {
  try {
    const details = await fn();
    ok(name, details || "");
  } catch (e) {
    const status = Number(e?.response?.status || 0);
    const msg = e?.response?.data?.error || e?.message || "unknown error";
    fail(name, status ? `${status} ${msg}` : String(msg));
  }
}

async function main() {
  let residentEstateId = "";
  let residentHomeId = "";
  let facilityEstateId = "";

  await runCheck("Resident /me/context", async () => {
    const { data } = await resident.get("/me/context");
    residentEstateId = String(data?.estate_id || data?.estate?.id || "");
    residentHomeId = String(data?.home_id || data?.home?.id || "");
    if (!residentEstateId) throw new Error("resident has no estate_id");
    return `estate=${residentEstateId} home=${residentHomeId || "none"}`;
  });

  await runCheck("Facility /facility/overview", async () => {
    const { data } = await facility.get("/facility/overview");
    facilityEstateId = String(data?.estate_id || "");
    if (!facilityEstateId) throw new Error("facility user has no estate_id");
    return `estate=${facilityEstateId}`;
  });

  await runCheck("Estate alignment (resident vs facility)", async () => {
    if (!residentEstateId || !facilityEstateId) throw new Error("missing estate ids");
    if (residentEstateId !== facilityEstateId) {
      throw new Error(`mismatch resident=${residentEstateId} facility=${facilityEstateId}`);
    }
    return residentEstateId;
  });

  await runCheck("Resident community feed", async () => {
    const { data } = await resident.get(`/community/posts/estate/${encodeURIComponent(residentEstateId)}`);
    if (!Array.isArray(data)) throw new Error("community response not array");
    return `posts=${data.length}`;
  });

  await runCheck("Resident maintenance list", async () => {
    const { data } = await resident.get("/maintenance");
    const count = Array.isArray(data?.requests) ? data.requests.length : 0;
    return `requests=${count}`;
  });

  if (CREATE_TEST_MAINTENANCE) {
    await runCheck("Resident maintenance create", async () => {
      const payload = {
        home_id: residentHomeId || null,
        title: `Smoke check ${new Date().toISOString()}`,
        description: "Connectivity smoke test",
        priority: "low",
        category: "general",
      };
      const { data } = await resident.post("/maintenance", payload);
      if (!data?.request?.id) throw new Error("maintenance id missing");
      return `request_id=${data.request.id}`;
    });
  }

  await runCheck("Facility maintenance list", async () => {
    const { data } = await facility.get("/facility/maintenance");
    const count = Array.isArray(data?.requests) ? data.requests.length : 0;
    return `requests=${count}`;
  });

  await runCheck("Resident wallet fetch", async () => {
    const { data } = await resident.get("/wallets");
    if (!data?.id) throw new Error("wallet id missing");
    return `wallet=${data.id} balance=${data.balance ?? 0}`;
  });

  await runCheck("Resident services payment history", async () => {
    const { data } = await resident.get("/services/payments?limit=5");
    const count = Array.isArray(data?.payments) ? data.payments.length : 0;
    return `payments=${count}`;
  });

  if (CREATE_TEST_SERVICE_PAYMENT) {
    await runCheck("Resident service payment (wallet)", async () => {
      const { data: context } = await resident.get("/me/context");
      const meter = String(context?.home?.electricity_meter || "").trim();
      if (!meter) throw new Error("home.electricity_meter missing for service test");
      const { data } = await resident.post("/services/pay", {
        service_key: "utility_token",
        amount: SERVICE_TEST_AMOUNT,
        account_ref: meter,
      });
      if (!data?.receipt?.id) throw new Error("service receipt missing");
      return `receipt=${data.receipt.id}`;
    });
  }

  await runCheck("Resident notifications", async () => {
    const { data } = await resident.get("/notifications?unread=true");
    const count = Array.isArray(data?.items) ? data.items.length : 0;
    return `unread=${count}`;
  });

  await runCheck("Facility camera security report", async () => {
    const { data } = await facility.get("/cameras/reports/security?period=daily");
    if (!data?.ok) throw new Error("security report failed");
    return `events=${data?.report?.totalEvents ?? 0}`;
  });

  if (CREATE_TEST_INVITE) {
    if (!HOME_ID || !RESIDENT_EMAIL) {
      fail("Facility invite create", "set HOME_ID and RESIDENT_EMAIL for invite test");
    } else {
      await runCheck("Facility invite create", async () => {
        const { data } = await facility.post(`/facility/homes/${encodeURIComponent(HOME_ID)}/invite`, {
          email: RESIDENT_EMAIL,
          role: "home_member",
        });
        if (!data?.invite?.id) throw new Error("invite id missing");
        return `invite=${data.invite.id}`;
      });

      await runCheck("Resident invites list", async () => {
        const { data } = await resident.get("/invites/mine");
        const count = Array.isArray(data?.invites) ? data.invites.length : 0;
        return `invites=${count}`;
      });
    }
  }

  const failed = checks.filter((c) => c.status === "FAIL");
  console.table(checks);
  if (failed.length) {
    console.error(`Smoke failed: ${failed.length} check(s)`);
    process.exit(2);
  }
  console.log("Smoke passed: all checks green");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
