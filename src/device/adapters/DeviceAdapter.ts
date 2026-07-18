// src/device/adapters/DeviceAdapter.ts

import { AdapterContext, DiscoveredDevice } from "./types";
import { Signal } from "../../core/control-plane/contracts/signal.types";

/**
 * All device adapters MUST implement this interface
 */
export interface DeviceAdapter {
  /** Adapter identifier */
  readonly name: string;           // "tuya", "wifi", "ble"
  readonly vendor: string;         // "Tuya", "Generic", "Custom"
  readonly protocols: string[];    // ["cloud"], ["wifi"], ["ble"]

  /**
   * Discover devices accessible under this context
   * Does NOT bind or control — discovery only
   */
  discover(context: AdapterContext): Promise<DiscoveredDevice[]>;

  /**
   * Bind a discovered device to the platform
   * Called once, after user confirmation
   */
  bindDevice(
    device: DiscoveredDevice,
    context: AdapterContext
  ): Promise<void>;

  /**
   * Execute a command on a device
   * This is called ONLY via IntentWorker
   */
  executeCommand(
    deviceId: string,
    command: Record<string, any>,
    context: AdapterContext
  ): Promise<void>;

  /** Read provider state for synchronization into the canonical Oyi runtime. */
  getLiveState?(deviceId: string): Promise<Record<string, any>>;

  /** Optional IR transport discovery for providers that expose bound virtual remotes. */
  listIrRemotes?(infraredId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional IR remote key/schema lookup for a bound virtual remote. */
  listIrRemoteKeys?(infraredId: string, remoteId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional IR command dispatch through a physical hub and provider remote binding. */
  executeIrRemoteCommand?(
    infraredId: string,
    remoteId: string,
    command: Record<string, any>,
    context: AdapterContext
  ): Promise<void>;

  /**
   * Start listening to device events / state changes
   * Adapter MUST emit Signals into Control Plane
   */
  startEventStream(
    context: AdapterContext,
    emit: (signal: Signal) => Promise<void>
  ): Promise<void>;

  /**
   * Optional cleanup / disconnect
   */
  shutdown?(): Promise<void>;
}
