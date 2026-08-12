import type { CommunicationRtcConfig } from "./communicationContracts";

function parseJsonArray(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function splitList(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getCommunicationRtcConfig(): Promise<CommunicationRtcConfig> {
  const twilioAccountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const twilioAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (twilioAccountSid && twilioAuthToken) {
    try {
      const ttl = Math.max(300, Math.min(Number(process.env.LIVE_TWILIO_TTL || 3600), 86400));
      const body = new URLSearchParams();
      body.set("Ttl", String(ttl));

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Tokens.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        }
      );

      if (response.ok) {
        const data: any = await response.json();
        if (Array.isArray(data?.ice_servers) && data.ice_servers.length) {
          return {
            iceServers: data.ice_servers,
            iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
          };
        }
      } else {
        const text = await response.text();
        console.warn("twilio rtc config request failed:", response.status, text);
      }
    } catch (error) {
      console.warn("twilio rtc config request failed:", error);
    }
  }

  const direct = parseJsonArray(process.env.LIVE_ICE_SERVERS_JSON);
  if (direct?.length) {
    return {
      iceServers: direct,
      iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
    };
  }

  const stunUrls = splitList(process.env.LIVE_STUN_URLS);
  const turnUrls = splitList(process.env.LIVE_TURN_URLS || process.env.LIVE_TURN_URL);
  const iceServers: CommunicationRtcConfig["iceServers"] = [];

  const effectiveStun = stunUrls.length ? stunUrls : ["stun:stun.l.google.com:19302"];
  if (effectiveStun.length) {
    iceServers.push({ urls: effectiveStun });
  }

  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.LIVE_TURN_USERNAME || "",
      credential: process.env.LIVE_TURN_CREDENTIAL || "",
    });
  }

  return {
    iceServers,
    iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
  };
}
