export const DEVICE_CAPABILITY_KEYS = [
  "devices.status",
  "devices.activity",
  "devices.failures",
  "devices.diagnosis",
  "devices.relationships",
  "devices.control.power",
  "devices.control.channel",
] as const;

export type DeviceCapabilityKey = typeof DEVICE_CAPABILITY_KEYS[number];
