export function assertAuthorizedMediaUrl(candidate: string, configuredPlaylistUrl: string) {
  let target: URL;
  let configured: URL;
  try {
    target = new URL(candidate, configuredPlaylistUrl);
    configured = new URL(configuredPlaylistUrl);
  } catch {
    throw new Error("invalid_media_url");
  }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("invalid_media_scheme");
  if (target.protocol !== configured.protocol || target.hostname !== configured.hostname || target.port !== configured.port) {
    throw new Error("media_origin_mismatch");
  }
  const configuredBase = configured.pathname.slice(0, configured.pathname.lastIndexOf("/") + 1) || "/";
  if (!target.pathname.startsWith(configuredBase)) throw new Error("media_path_mismatch");
  target.username = "";
  target.password = "";
  return target.toString();
}
