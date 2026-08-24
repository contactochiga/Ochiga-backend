import { cleanupExpiredMedia } from "../modules/cameras/cameraMedia.service";
let timer:NodeJS.Timeout|null=null;
export function startCameraMediaRetentionWorker(){if(timer||process.env.CAMERA_MEDIA_RETENTION_ENABLED==="false")return;const run=()=>cleanupExpiredMedia().catch((error)=>console.error(JSON.stringify({event:"camera_media.retention.failed",code:String(error?.message||"storage_unavailable")})));void run();timer=setInterval(run,Math.max(60000,Number(process.env.CAMERA_MEDIA_RETENTION_INTERVAL_MS||3600000)));timer.unref();}
export function stopCameraMediaRetentionWorker(){if(timer)clearInterval(timer);timer=null;}
