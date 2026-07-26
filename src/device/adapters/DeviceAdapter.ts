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
  ): Promise<Record<string, any> | void>;

  /** Read provider state for synchronization into the canonical Oyi runtime. */
  getLiveState?(deviceId: string): Promise<Record<string, any>>;

  /** Optional IR transport discovery for providers that expose bound virtual remotes. */
  listIrRemotes?(infraredId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional IR remote key/schema lookup for a bound virtual remote. */
  listIrRemoteKeys?(infraredId: string, remoteId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional read-only IR hub capability/catalogue evidence for management readiness. */
  auditIrHubCapabilities?(infraredId: string, context?: AdapterContext): Promise<Record<string, any>>;

  /** Optional IR command dispatch through a physical hub and provider remote binding. */
  executeIrRemoteCommand?(
    infraredId: string,
    remoteId: string,
    command: Record<string, any>,
    context: AdapterContext
  ): Promise<Record<string, any> | void>;

  /** Optional provider evidence for capability-driven smart access devices. */
  discoverCapabilities?(deviceId: string, context?: AdapterContext): Promise<Record<string, any>>;

  /** Optional provider-normalized smart access state. */
  readSmartAccessState?(deviceId: string, context?: AdapterContext): Promise<Record<string, any>>;

  /** Optional provider access-record lookup for smart access devices. */
  listAccessRecords?(deviceId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional provider member lookup for smart access devices. */
  listMembers?(deviceId: string, context?: AdapterContext): Promise<any[]>;

  /** Optional provider-backed credential creation for smart access devices. */
  createCredential?(deviceId: string, credential: Record<string, any>, context?: AdapterContext): Promise<Record<string, any>>;

  /** Optional provider-backed credential revocation for smart access devices. */
  revokeCredential?(deviceId: string, credentialId: string, context?: AdapterContext): Promise<Record<string, any>>;

  /** Optional short-lived media session for camera/doorbell-enabled access devices. */
  requestMediaSession?(deviceId: string, context?: AdapterContext): Promise<Record<string, any>>;

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
