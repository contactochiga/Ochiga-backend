export const DEVICE_CAPABILITIES: Record<string, string[]> = {
  light_switch: ["power.on", "power.off"],
  smart_lock: ["lock", "unlock"],
  camera: ["stream.start", "stream.stop", "rotate"],
};
