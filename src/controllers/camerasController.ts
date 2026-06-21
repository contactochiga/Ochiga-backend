// src/controllers/camerasController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { scanCameras } from "../device/cameras/cameraOrchestrator";
import { canAccessCamera } from "../modules/cameras/cameraAccess.policy";
import { buildCameraPlaybackContract } from "../modules/cameras/cameraPlayback.service";
import {
  buildChannelRows,
  buildCredentialRef,
  channelStreamKey,
  displayCameraBrand,
  normalizeCameraBrand,
  normalizeDvrStatus,
  providerForBrand,
  rtspPathTemplateForBrand,
  testTcpReachability,
} from "../modules/cameras/cameraDvr.service";

function pickError(err: any, fallback: string) {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

function clean(value: any, fallback = "") {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function intFrom(value: any, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function assertEstateMember(user: any, estateId: string) {
  if (String(user?.role || "").toLowerCase() === "admin") return null;
  const { data: membership, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("id, role, status")
    .eq("estate_id", estateId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!membership) return { status: 403, error: "Unauthorized (not a member of this estate)" };
  if (membership.status && membership.status !== "active") return { status: 403, error: "Unauthorized (membership not active)" };
  return null;
}

/**
 * POST /cameras/scan
 * body: { cidr?: "192.168.100.0/24", username?: "admin", password?: "admin" }
 * Scans LAN for ONVIF cameras + returns RTSP URIs where possible.
 */
export async function scan(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cidr, username, password } = req.body || {};

  try {
    const devices = await scanCameras({
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        cidr,
        username,
        password,
      },
    });

    return res.json({ ok: true, items: devices });
  } catch (err: any) {
    return res.status(500).json({ error: pickError(err, "Scan failed") });
  }
}

/**
 * GET /cameras/estate/:estateId
 * Lists bound cameras for estate (facility UI)
 */
export async function listByEstate(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { estateId } = req.params;
  if (!estateId) return res.status(400).json({ error: "estateId is required" });

  // ✅ Admin can read all
  if (user.role !== "admin") {
    // ✅ Check membership table (source of truth)
    const { data: membership, error: mErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("id, role, status")
      .eq("estate_id", estateId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (mErr) return res.status(500).json({ error: mErr.message });

    if (!membership) {
      return res
        .status(403)
        .json({ error: "Unauthorized (not a member of this estate)" });
    }

    // optional: enforce status
    if (membership.status && membership.status !== "active") {
      return res.status(403).json({ error: "Unauthorized (membership not active)" });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("*")
    .eq("estate_id", estateId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).filter((camera: any) => canAccessCamera(camera, user).ok);
  return res.json({ ok: true, items });
}

/**
 * GET /cameras/home/:homeId
 * Lists private home cameras scoped through camera metadata.
 */
export async function listByHome(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { homeId } = req.params;
  if (!homeId) return res.status(400).json({ error: "homeId is required" });
  if (String(user.home_id || "") !== String(homeId) && String(user.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Permission denied" });
  }

  let query = supabaseAdmin.from("facility_cameras").select("*").order("created_at", { ascending: false });
  if (user.estate_id) query = query.eq("estate_id", user.estate_id);
  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).filter((camera: any) => canAccessCamera(camera, user).ok);
  return res.json({ ok: true, items });
}

/**
 * POST /cameras/bind
 * body: { estateId, name, ip, onvif_port?, rtsp_url, username?, password? }
 */
export async function bind(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { estateId, name, ip, onvif_port, rtsp_url, username, password, credential_ref, location, camera_type, privacy_scope, access_policy, edge_node_id, dvr_id, channel_number, enabled } =
    req.body || {};

  const resolvedEstateId = estateId || user.estate_id;
  if (!resolvedEstateId) return res.status(400).json({ error: "estateId is required" });
  if (!ip) return res.status(400).json({ error: "ip is required" });
  if (!rtsp_url && !credential_ref) return res.status(400).json({ error: "rtsp_url or credential_ref is required" });
  const membershipError = await assertEstateMember(user, resolvedEstateId);
  if (membershipError) return res.status(membershipError.status).json({ error: "Permission denied" });

  const safePrivacyScope = ["facility", "home", "office"].includes(String(privacy_scope || "").toLowerCase())
    ? String(privacy_scope).toLowerCase()
    : "facility";
  const safeCameraType = ["ip_camera", "dvr_channel", "nvr_channel"].includes(String(camera_type || "").toLowerCase())
    ? String(camera_type).toLowerCase()
    : (dvr_id || channel_number ? "dvr_channel" : "ip_camera");
  const credentialRef = String(credential_ref || "").trim() || (username || password ? "local:camera-credential-required" : null);
  const metadata = {
    camera_type: safeCameraType,
    privacy_scope: safePrivacyScope,
    access_policy: access_policy && typeof access_policy === "object" ? access_policy : {},
    credentials_present: Boolean(username || password || credentialRef),
    credential_storage: credentialRef ? "edge_local_reference" : "none",
    home_id: safePrivacyScope === "home" ? user.home_id || null : undefined,
  };

  const existingQuery = supabaseAdmin.from("facility_cameras").select("*").eq("estate_id", resolvedEstateId);
  const { data: existing } =
    dvr_id && channel_number
      ? await existingQuery.eq("nvr_id", dvr_id).eq("channel", String(channel_number)).maybeSingle()
      : await existingQuery.eq("ip", ip).is("nvr_id", null).maybeSingle();

  if (existing) {
    // update instead
    const { data, error } = await supabaseAdmin
      .from("facility_cameras")
      .update({
        name: name ?? existing.name,
        onvif_port: onvif_port ?? existing.onvif_port,
        rtsp_url: rtsp_url ?? existing.rtsp_url,
        username: null,
        password: null,
        location: location ?? existing.location,
        edge_node_id: edge_node_id ?? existing.edge_node_id,
        nvr_id: dvr_id ?? existing.nvr_id,
        channel: channel_number ? String(channel_number) : existing.channel,
        credential_ref: credentialRef ?? existing.credential_ref,
        privacy_scope: safePrivacyScope,
        metadata: { ...(existing.metadata || {}), ...metadata },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, camera: data });
  }

  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .insert({
      estate_id: resolvedEstateId,
      name: name ?? `Camera ${ip}`,
      ip,
      onvif_port: onvif_port ?? null,
      rtsp_url: rtsp_url ?? null,
      username: null,
      password: null,
      location: location ?? null,
      edge_node_id: edge_node_id ?? null,
      nvr_id: dvr_id ?? null,
      channel: channel_number ? String(channel_number) : null,
      credential_ref: credentialRef,
      privacy_scope: safePrivacyScope,
      status: enabled === false ? "disabled" : "pending",
      metadata,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, camera: data });
}

export async function testDvrConnection(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const estateId = clean(req.body?.estateId || user.estate_id);
  const ipAddress = clean(req.body?.ip_address || req.body?.ip);
  const brand = normalizeCameraBrand(req.body?.brand);
  const port = intFrom(req.body?.port, 554);
  const suppliedChannelCount = intFrom(req.body?.channel_count, 0);
  if (!estateId) return res.status(400).json({ error: "estateId is required" });
  if (!ipAddress) return res.status(400).json({ error: "ip_address is required" });

  const membershipError = await assertEstateMember(user, estateId);
  if (membershipError) return res.status(membershipError.status).json({ error: membershipError.error });

  const tcp = await testTcpReachability(ipAddress, port);
  const status = tcp.reachable ? (suppliedChannelCount > 0 ? "healthy" : "warning") : "failed";
  return res.status(tcp.reachable ? 200 : 424).json({
    ok: tcp.reachable,
    status,
    dvr_online: tcp.reachable,
    brand,
    brand_label: displayCameraBrand(brand),
    model: clean(req.body?.model) || null,
    ip_address: ipAddress,
    port,
    onvif_enabled: Boolean(req.body?.onvif_enabled),
    rtsp_enabled: tcp.reachable,
    channel_count: suppliedChannelCount,
    channels: buildChannelRows(suppliedChannelCount),
    latency_ms: tcp.latency_ms,
    message: tcp.reachable
      ? suppliedChannelCount > 0
        ? "DVR reachable. Channels are ready to name and import."
        : "DVR reachable. Enter the channel count to import channels."
      : `DVR is not reachable from backend network${tcp.error ? `: ${tcp.error}` : "."}`,
  });
}

export async function importDvr(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const body = req.body || {};
  const estateId = clean(body.estateId || body.estate_id || user.estate_id);
  const name = clean(body.name, "Estate DVR");
  const brand = normalizeCameraBrand(body.brand);
  const ipAddress = clean(body.ip_address || body.ip);
  const port = intFrom(body.port, 554);
  const channelCount = Math.max(0, Math.min(intFrom(body.channel_count, 0), 128));
  const edgeNodeId = clean(body.edge_node_id);
  const credentialRef = clean(body.credential_ref) || buildCredentialRef({ estateId, name, ipAddress, prefix: "dvr" });
  if (!estateId) return res.status(400).json({ error: "estateId is required" });
  if (!ipAddress) return res.status(400).json({ error: "ip_address is required" });
  if (channelCount < 1) return res.status(400).json({ error: "channel_count is required" });

  const membershipError = await assertEstateMember(user, estateId);
  if (membershipError) return res.status(membershipError.status).json({ error: membershipError.error });

  const tcp = await testTcpReachability(ipAddress, port).catch(() => ({ reachable: false, latency_ms: null as number | null }));
  const status = normalizeDvrStatus(Boolean(tcp.reachable), channelCount);
  const dvrRow = {
    estate_id: estateId,
    name,
    brand,
    model: clean(body.model) || null,
    ip_address: ipAddress,
    port,
    credential_ref: credentialRef,
    channel_count: channelCount,
    edge_node_id: edgeNodeId || null,
    onvif_enabled: Boolean(body.onvif_enabled),
    rtsp_enabled: true,
    status,
    last_seen_at: tcp.reachable ? new Date().toISOString() : null,
    metadata: {
      brand_label: displayCameraBrand(brand),
      provider: providerForBrand(brand),
      rtsp_path_template: rtspPathTemplateForBrand(brand),
      credential_storage: "edge_local_reference",
      connection_test: tcp,
      imported_by: user.id,
    },
    created_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data: existingDvr } = await supabaseAdmin
    .from("camera_dvrs")
    .select("*")
    .eq("estate_id", estateId)
    .eq("ip_address", ipAddress)
    .maybeSingle();

  const dvrResult = existingDvr?.id
    ? await supabaseAdmin.from("camera_dvrs").update(dvrRow as any).eq("id", existingDvr.id).select("*").single()
    : await supabaseAdmin.from("camera_dvrs").insert(dvrRow as any).select("*").single();

  if (dvrResult.error) return res.status(500).json({ error: dvrResult.error.message });
  const dvr = dvrResult.data;
  const channels = buildChannelRows(channelCount, Array.isArray(body.channels) ? body.channels : []);
  const cameras = [] as any[];
  const errors = [] as any[];

  for (const channel of channels.filter((item) => item.enabled !== false)) {
    const cameraName = clean(channel.camera_name, `${name} Channel ${channel.channel_number}`);
    const privacyScope = ["facility", "home", "office"].includes(clean(channel.privacy_scope)) ? clean(channel.privacy_scope) : "facility";
    const row = {
      estate_id: estateId,
      camera_id: channelStreamKey({ dvrId: dvr.id, ipAddress, channelNumber: channel.channel_number }),
      name: cameraName,
      location: clean(channel.location) || null,
      ip: ipAddress,
      stream_protocol: "rtsp",
      provider: providerForBrand(brand),
      rtsp_url: null,
      onvif_port: null,
      username: null,
      password: null,
      edge_node_id: edgeNodeId || null,
      nvr_id: dvr.id,
      channel: String(channel.channel_number),
      rtsp_path_template: rtspPathTemplateForBrand(brand),
      credential_ref: credentialRef,
      privacy_scope: privacyScope,
      status: status === "online" ? "pending_stream_details" : "pending",
      health_status: "pending_stream_details",
      metadata: {
        camera_type: "dvr_channel",
        privacy_scope: privacyScope,
        dvr_id: dvr.id,
        dvr_name: name,
        dvr_brand: brand,
        channel_number: channel.channel_number,
        stream_key: channelStreamKey({ dvrId: dvr.id, ipAddress, channelNumber: channel.channel_number }),
        credential_ref: credentialRef,
        credential_storage: "edge_local_reference",
        rtsp_path_template: rtspPathTemplateForBrand(brand),
      },
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data: existingCamera } = await supabaseAdmin
      .from("facility_cameras")
      .select("id")
      .eq("estate_id", estateId)
      .eq("nvr_id", dvr.id)
      .eq("channel", String(channel.channel_number))
      .maybeSingle();

    const result = existingCamera?.id
      ? await supabaseAdmin.from("facility_cameras").update(row as any).eq("id", existingCamera.id).select("*").single()
      : await supabaseAdmin.from("facility_cameras").insert(row as any).select("*").single();
    if (result.error) errors.push({ channel: channel.channel_number, error: result.error.message });
    else cameras.push(result.data);
  }

  return res.status(errors.length ? 207 : 200).json({
    ok: errors.length === 0,
    dvr,
    cameras,
    errors,
    edge_registry_ready: cameras.length > 0,
    message: errors.length ? "DVR imported with some channel errors." : "DVR imported and channel cameras prepared.",
  });
}

export async function listDvrsByEstate(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const estateId = clean(req.params.estateId || user.estate_id);
  if (!estateId) return res.status(400).json({ error: "estateId is required" });
  const membershipError = await assertEstateMember(user, estateId);
  if (membershipError) return res.status(membershipError.status).json({ error: membershipError.error });
  const { data, error } = await supabaseAdmin.from("camera_dvrs").select("*").eq("estate_id", estateId).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, items: data || [] });
}

export async function inventoryByEstate(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const estateId = clean(req.params.estateId || user.estate_id);
  if (!estateId) return res.status(400).json({ error: "estateId is required" });
  const membershipError = await assertEstateMember(user, estateId);
  if (membershipError) return res.status(membershipError.status).json({ error: membershipError.error });

  const [dvrs, cameras] = await Promise.all([
    supabaseAdmin.from("camera_dvrs").select("*").eq("estate_id", estateId).order("created_at", { ascending: false }),
    supabaseAdmin.from("facility_cameras").select("*").eq("estate_id", estateId).order("created_at", { ascending: false }),
  ]);
  if (dvrs.error) return res.status(500).json({ error: dvrs.error.message });
  if (cameras.error) return res.status(500).json({ error: cameras.error.message });
  const cameraItems = (cameras.data || []).filter((camera: any) => canAccessCamera(camera, user).ok);
  const healthy = cameraItems.filter((camera: any) => ["online", "active", "healthy", "ok"].includes(clean(camera.stream_status || camera.health_status || camera.status).toLowerCase())).length;
  const offline = cameraItems.filter((camera: any) => ["offline", "error", "failed", "degraded"].includes(clean(camera.stream_status || camera.health_status || camera.status).toLowerCase())).length;
  const edgeNodes = new Set(cameraItems.map((camera: any) => clean(camera.edge_node_id)).filter(Boolean));
  const aiEnabled = cameraItems.filter((camera: any) => Boolean(camera.ai_enabled)).length;
  return res.json({
    ok: true,
    dvrs: dvrs.data || [],
    cameras: cameraItems,
    summary: {
      dvrs: dvrs.data?.length || 0,
      cameras: cameraItems.length,
      healthy_streams: healthy,
      offline_streams: offline,
      edge_nodes: edgeNodes.size,
      ai_enabled_cameras: aiEnabled,
    },
  });
}

export async function edgeRegistry(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const estateId = clean(req.params.estateId || user.estate_id);
  if (!estateId) return res.status(400).json({ error: "estateId is required" });
  const membershipError = await assertEstateMember(user, estateId);
  if (membershipError) return res.status(membershipError.status).json({ error: membershipError.error });
  const { data, error } = await supabaseAdmin.from("facility_cameras").select("*").eq("estate_id", estateId).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const cameras = (data || []).filter((camera: any) => canAccessCamera(camera, user).ok).map((camera: any) => ({
    camera_id: camera.camera_id || camera.id,
    name: camera.name || camera.location || "Camera",
    provider: camera.provider || camera.metadata?.provider || "generic_rtsp",
    protocol: camera.stream_protocol || camera.metadata?.protocol || "rtsp",
    host: camera.ip,
    dvr_id: camera.nvr_id || camera.metadata?.dvr_id || null,
    channel: camera.channel || camera.metadata?.channel_number || "1",
    credential_ref: camera.credential_ref || camera.metadata?.credential_ref || null,
    rtsp_path_template: camera.rtsp_path_template || camera.metadata?.rtsp_path_template || rtspPathTemplateForBrand(camera.provider),
    enabled: camera.status !== "disabled",
  }));
  return res.json({ ok: true, site_id: estateId, cameras });
}

export async function validateStream(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { cameraId } = req.params;
  const { data: camera, error } = await supabaseAdmin.from("facility_cameras").select("*").eq("id", cameraId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!camera) return res.status(404).json({ error: "Camera not found" });
  const access = canAccessCamera(camera, user);
  if (!access.ok) return res.status(403).json({ error: "Permission denied", code: access.reason });

  const playback = buildCameraPlaybackContract(req, camera, user, 0);
  const rtspReady = Boolean(camera.rtsp_url || camera.credential_ref);
  const hlsReady = Boolean(playback.hls_url);
  const status = rtspReady && hlsReady ? "healthy" : rtspReady ? "warning" : "failed";
  return res.status(status === "failed" ? 424 : 200).json({
    ok: status !== "failed",
    status,
    checks: {
      rtsp_reachable: rtspReady ? "prepared_for_edge" : "missing_source",
      hls_generation: hlsReady ? "ready" : "waiting_for_edge_runtime",
      playback_contract: playback.ok ? "ready" : "warning",
    },
    playback,
    reason: status === "healthy" ? "Stream playback contract is ready." : status === "warning" ? "Camera source is prepared; Edge must publish HLS health." : "Camera is missing RTSP or credential reference.",
  });
}

/**
 * POST /cameras/bind-from-discovery
 * body: {
 *   estateId?, name?, ip, onvif_port?, xaddr?, username?, password?,
 *   rtsp_url?, rtsp_port?
 * }
 *
 * Edge discovery gives ONVIF details; bind() requires rtsp_url.
 * This generates a best-guess RTSP URL (or uses provided rtsp_url),
 * then reuses bind() so DB logic stays consistent.
 */
export async function bindFromDiscovery(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const {
    estateId,
    name,
    ip,
    onvif_port,
    xaddr, // optional (kept for future use)
    username,
    password,
    rtsp_url,
    rtsp_port,
  } = req.body || {};

  const resolvedEstateId = estateId || user.estate_id;
  if (!resolvedEstateId) return res.status(400).json({ error: "estateId is required" });
  if (!ip) return res.status(400).json({ error: "ip is required" });
  const membershipError = await assertEstateMember(user, resolvedEstateId);
  if (membershipError) return res.status(membershipError.status).json({ error: "Permission denied" });

  // If RTSP is already known, just bind directly using existing bind()
  if (rtsp_url) {
    req.body = {
      estateId: resolvedEstateId,
      name,
      ip,
      onvif_port,
      rtsp_url,
      username,
      password,
    };
    return bind(req, res);
  }

  // Generate RTSP candidates (common patterns)
  const port = Number(rtsp_port || 554);
  const userPart =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";

  const candidates = [
    `rtsp://${userPart}${ip}:${port}/live`,
    `rtsp://${userPart}${ip}:${port}/h264`,
    `rtsp://${userPart}${ip}:${port}/h264/ch1/main/av_stream`,
    `rtsp://${userPart}${ip}:${port}/h264/ch1/sub/av_stream`,
    `rtsp://${userPart}${ip}:${port}/cam/realmonitor?channel=1&subtype=0`,
    `rtsp://${userPart}${ip}:${port}/cam/realmonitor?channel=1&subtype=1`,
    `rtsp://${userPart}${ip}:${port}/Streaming/Channels/101`,
    `rtsp://${userPart}${ip}:${port}/Streaming/Channels/102`,
    `rtsp://${userPart}${ip}:${port}/stream1`,
    `rtsp://${userPart}${ip}:${port}/stream2`,
  ];

  // Pick the first candidate (for now). You can override later by sending rtsp_url explicitly.
  const chosen = candidates[0];

  // Reuse bind() to write/update facility_cameras
  req.body = {
    estateId: resolvedEstateId,
    name: name ?? `Camera ${ip}`,
    ip,
    onvif_port: onvif_port ?? null,
    rtsp_url: chosen,
    username: username ?? null,
    password: password ?? null,
    // keep for debugging (bind ignores unknown fields)
    xaddr: xaddr ?? null,
    rtsp_candidates: candidates,
  };

  return bind(req, res);
}
