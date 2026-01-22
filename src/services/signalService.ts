import API from "./api";

export type DeviceCommandSignal = {
  type: "device.command";
  source?: string; // "consumer-ui"
  deviceId: string;
  capability: string;
  value: any;
  meta?: Record<string, any>;

  // optional context (if you have them)
  estateId?: string;
  homeId?: string;
  roomId?: string;
};

export const signalService = {
  async sendDeviceCommand(payload: Omit<DeviceCommandSignal, "type"> & { type?: string }) {
    const res = await API.post("/signals", {
      type: "device.command",
      source: "consumer-ui",
      ...payload,
    });

    // returns { status:"accepted", signalType:"device.command" }
    return res.data;
  },
};
