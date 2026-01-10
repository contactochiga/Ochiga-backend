// src/device/adapters/types.ts

/**
 * ================================
 * DISCOVERED DEVICE (CANONICAL)
 * ================================
 * Vendor-agnostic device identity
 * produced by any adapter
 */
export interface DiscoveredDevice {
  /** Vendor / gateway specific ID */
  externalId: string;

  /** Which adapter discovered it (tuya, zigbee, ble, wifi, mqtt, etc.) */
  adapter: string;

  /** Human-friendly name */
  name: string;

  /** Device category */
  category:
    | "light"
    | "switch"
    | "socket"
    | "sensor"
    | "lock"
    | "camera"
    | "thermostat"
    | "gateway"
    | "unknown";

  /** Supported commands / states */
  capabilities: string[];

  /** Communication protocols */
  protocols: Array<"wifi" | "zigbee" | "ble" | "cloud" | "mqtt" | string>;

  /** Online / reachable */
  online: boolean;

  /** Vendor payload & diagnostics */
  metadata?: {
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    signalStrength?: number;
    raw?: Record<string, any>;
  };
}

/**
 * ================================
 * ADAPTER CONTEXT
 * ================================
 * Boundary info passed into adapters
 * (NO control-plane imports here)
 */
export interface AdapterContext {
  /** Estate boundary */
  estateId: string;

  /** Optional home/unit boundary */
  homeId?: string;

  /** User initiating discovery */
  userId: string;

  /** Adapter-specific credentials */
  credentials: {
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    gatewayId?: string;
    [key: string]: any;
  };
}
