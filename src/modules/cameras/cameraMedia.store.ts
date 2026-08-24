import { supabaseAdmin } from "../../supabase/supabaseClient";

export interface CameraMediaStore {
  put(key:string, bytes:Buffer, mimeType:string):Promise<void>;
  getSignedRead(key:string, expiresInSeconds:number):Promise<{url:string;expiresAt:string}>;
  delete(key:string):Promise<void>;
  exists(key:string):Promise<boolean>;
}

export class SupabaseCameraMediaStore implements CameraMediaStore {
  constructor(private bucket=process.env.CAMERA_MEDIA_BUCKET||"camera-media-private") {}
  async put(key:string,bytes:Buffer,mimeType:string){const {error}=await supabaseAdmin.storage.from(this.bucket).upload(key,bytes,{contentType:mimeType,upsert:false});if(error)throw new Error("storage_unavailable");}
  async getSignedRead(key:string,expiresInSeconds:number){const {data,error}=await supabaseAdmin.storage.from(this.bucket).createSignedUrl(key,expiresInSeconds);if(error||!data?.signedUrl)throw new Error("storage_unavailable");return{url:data.signedUrl,expiresAt:new Date(Date.now()+expiresInSeconds*1000).toISOString()};}
  async delete(key:string){const {error}=await supabaseAdmin.storage.from(this.bucket).remove([key]);if(error&&!/not found/i.test(error.message))throw new Error("storage_unavailable");}
  async exists(key:string){const slash=key.lastIndexOf("/");const {data,error}=await supabaseAdmin.storage.from(this.bucket).list(key.slice(0,slash),{search:key.slice(slash+1),limit:1});if(error)return false;return Boolean(data?.some((row)=>row.name===key.slice(slash+1)));}
}
