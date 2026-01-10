// src/device/adapters/types.ts

import { Signal } from "../../core/control-plane/contracts/signal.types";

/**
 * Device identity as seen by the platform
 * (vendor-agnostic)
 */
export interface DiscoveredDevice {
  externalId: string;        // vendor / gateway ID
  name: string;
  category: string;          // light, switch, lock, camera, etc.
  capabilities: string[];    // on/off, dim, lock, temperature, etc.
  protocols: string[];       // wifi, zigbee, ble, cloud
  metadata?: Record<string, any>;
}

/**
 * Context passed to adapters
 * (estate / home / user boundary)
 */
export interface AdapterContext {
  estateId: string;
  homeId?: string;
  userId: string;
  credentials: Record<string, any>; // API keys, tokens, gateway IDs
}
