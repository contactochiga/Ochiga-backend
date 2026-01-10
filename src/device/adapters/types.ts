// src/device/adapters/types.ts

/**
 * ================================
 * DEVICE PROTOCOLS (CANONICAL)
 * ================================
 */
export type DeviceProtocol =
  | "wifi"
  | "zigbee"
  | "ble"
  | "cloud"
  | "mqtt"
  | "modbus"
  | "http"
  | "other";

/**
 * ================================
 * DEVICE CATEGORIES
 * ================================
 */
export type DeviceCategory =
  | "light"
  | "switch"
  | "socket"
  | "sensor"
  | "lock"
  | "camera"
  | "thermostat"
  | "gateway"
  | "unknown";

/**
 * ================================
 * DISCOVERED DEVICE (CANONICAL)
 * ================================
 */
export interface DiscoveredDevice {
  /** Vendor / gateway specific ID */
  externalId: string;

  /** Which adapter discovered it */
  adapter: string;

  /** Human-friendly name */
  name: string;

  /** Device category */
  category: DeviceCategory;

  /** Supported commands / states */
  capabilities: string[];

  /** Communication protocols */
  protocols: DeviceProtocol[];

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
 */
export interface AdapterContext {
  estateId: string;
  homeId?: string;
  userId: string;

  credentials: {
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    gatewayId?: string;
    [key: string]: any;
  };
}
