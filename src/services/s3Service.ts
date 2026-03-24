// src/services/s3Service.ts
import AWS from "aws-sdk";

const accessKeyId =
  process.env.AWS_ACCESS_KEY ||
  process.env.AWS_ACCESS_KEY_ID ||
  process.env.S3_ACCESS_KEY;
const secretAccessKey =
  process.env.AWS_SECRET_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  process.env.S3_SECRET_KEY;
const region = process.env.AWS_REGION || process.env.S3_REGION;
const bucket =
  process.env.AWS_S3_BUCKET ||
  process.env.S3_BUCKET ||
  process.env.AWS_BUCKET;

const s3 = new AWS.S3({
  accessKeyId,
  secretAccessKey,
  region,
});

export async function uploadToS3(filename: string, buffer: Buffer, mime: string): Promise<string> {
  if (!bucket) {
    throw new Error("Media storage is not configured (missing AWS_S3_BUCKET/S3_BUCKET).");
  }

  const params = {
    Bucket: bucket,
    Key: filename,
    Body: buffer,
    ContentType: mime,
    ACL: "public-read",
  };

  await s3.putObject(params).promise();

  return `https://${bucket}.s3.amazonaws.com/${filename}`;
}
