
    const decoded = jwt.verify(token, APP_JWT_SECRET) as any;
    if (!decoded?.id || !decoded?.estate_id || !decoded?.role) return null;

    return decoded;
  } catch {
    return export async function hlsPlaylist(req: Request, res: Response) {
  // ✅ Use signed query token (NOT Authorization header)
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing token" });

  const { cameraId } = req.params;

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  // estate authorization
  if (
    String(cam.estate_id) !== String(user.estate_id) &&
    user.role !== "admin"
  ) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // ✅ EDGE-FIRST STREAMING
  if (!cam.edge_hls_url) {
    return res.status(409).json({
      error: "Camera has no edge stream attached",
    });
  }

  // 🔁 Redirect browser/player to EDGE HLS
  return res.redirect(302, cam.edge_hls_url);
}
