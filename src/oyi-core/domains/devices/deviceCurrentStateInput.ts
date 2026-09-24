// Provisioning inputs needed by current-state interpretation and snapshot enrichment.
// These are existing columns, not physical-state evidence. In particular, online/status
// are deliberately absent. Keep class aliases in one place rather than in each surface.
export const DEVICE_CURRENT_STATE_INPUT_SELECT = "id,is_virtual,type,category,metadata,adapter,provider,vendor,parent_device_id,external_id,capabilities";

export function deviceCurrentStateSelect<T extends string>(fields: T): `${typeof DEVICE_CURRENT_STATE_INPUT_SELECT},${T}`;
export function deviceCurrentStateSelect(): typeof DEVICE_CURRENT_STATE_INPUT_SELECT;
export function deviceCurrentStateSelect(fields = "") {
  return fields ? `${DEVICE_CURRENT_STATE_INPUT_SELECT},${fields}` : DEVICE_CURRENT_STATE_INPUT_SELECT;
}

export function deviceCurrentStateInput(device: Record<string, unknown>): Record<string, unknown> {
  const metadata = device.metadata && typeof device.metadata === "object" ? device.metadata as Record<string, unknown> : {};
  return {
    ...device,
    control_profile: device.control_profile || metadata.control_profile || null,
    device_type: device.device_type || metadata.device_type || device.type || device.category || null,
  };
}
