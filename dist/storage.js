import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { randomUUID } from "node:crypto";
const s3 = new S3Client({ region: process.env.AWS_REGION });
export async function putVideoWebm(buffer) {
    const bucket = process.env.AWS_S3_BUCKET;
    const key = `map-anim/${randomUUID()}.webm`;
    const upload = new Upload({
        client: s3,
        params: {
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: "video/webm"
        }
    });
    await upload.done();
    // Return an HTTPS URL (adjust if you front with CloudFront)
    return `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
