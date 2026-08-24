export type CameraRecordingPolicyMode="off"|"event_only"|"continuous"|"scheduled";
export interface CameraRecordingProvider {
  readonly id:string;
  start(cameraId:string,policy:{mode:CameraRecordingPolicyMode}):Promise<{providerSessionId:string}>;
  stop(cameraId:string):Promise<void>;
  getSegments(cameraId:string,range:{start:string;end:string}):Promise<Array<{providerReference:string;capturedAt:string;durationMs:number}>>;
  getClip(cameraId:string,input:{eventId?:string;start:string;end:string}):Promise<{available:false;reason:"clip_unavailable"}|{available:true;providerReference:string}>;
}

export class UnavailableRecordingProvider implements CameraRecordingProvider {
  readonly id="unavailable";async start():Promise<{providerSessionId:string}>{throw new Error("recording_unavailable");}async stop(){return;}async getSegments(){return[];}async getClip(){return{available:false as const,reason:"clip_unavailable" as const};}
}
