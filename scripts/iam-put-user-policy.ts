import { IAMClient, PutUserPolicyCommand } from "@aws-sdk/client-iam";

async function main() {
  const userName = process.env.IAM_USER_NAME || "remotion-user";
  const policyName = process.env.IAM_POLICY_NAME || "S3PutAccessTestmapanimation";
  const policyDocEnv = process.env.IAM_POLICY_DOCUMENT;
  const defaultPolicyDoc = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowListBucketForPrefix",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: "arn:aws:s3:::testmapanimationbucket",
        Condition: { StringLike: { "s3:prefix": ["map-anim/*"] } }
      },
      {
        Sid: "AllowPutObjectsInPrefix",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:AbortMultipartUpload",
          "s3:PutObjectTagging"
        ],
        Resource: "arn:aws:s3:::testmapanimationbucket/map-anim/*"
      }
    ]
  };

  const policyDocument = policyDocEnv ? JSON.parse(policyDocEnv) : defaultPolicyDoc;

  const region = process.env.AWS_REGION || "us-east-1";
  const client = new IAMClient({ region });

  const cmd = new PutUserPolicyCommand({
    UserName: userName,
    PolicyName: policyName,
    PolicyDocument: JSON.stringify(policyDocument)
  });

  try {
    const out = await client.send(cmd);
    console.log("PutUserPolicy success", { userName, policyName, region, out });
  } catch (err: any) {
    console.error("PutUserPolicy failed", err?.name, err?.message || String(err));
    process.exitCode = 1;
  }
}

main();

