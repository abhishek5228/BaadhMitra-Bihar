#!/usr/bin/env bash
# One command: build the 3D dashboard, create the AWS stack (API, Lambdas, queues, DynamoDB,
# Bedrock/Transcribe/Polly permissions, CloudFront site) and print the dashboard URL and key.
#
#   AWS_REGION=ap-south-1 MODEL_ID=<bedrock model or inference profile id> ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
command -v aws >/dev/null || { echo "Install the AWS CLI v2 first: https://aws.amazon.com/cli/"; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 22 first"; exit 1; }

ACC="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || {
  echo "AWS credentials are not set up. Run 'aws configure' (or 'aws sso login') and try again."
  exit 1
}
echo "Deploying BaadhMitra to account $ACC in $REGION"
[ -n "${MODEL_ID:-}" ] || echo "Note: MODEL_ID not set, using the default in cdk.json. If that model is not enabled for you in Bedrock, the app still works on its offline extractor."

export CDK_DEFAULT_ACCOUNT="$ACC" CDK_DEFAULT_REGION="$REGION" AWS_REGION="$REGION"
npm ci
npm test
npm run web:build
npx cdk bootstrap "aws://$ACC/$REGION"
npx cdk deploy --require-approval never ${MODEL_ID:+-c modelId="$MODEL_ID"} --outputs-file cdk-outputs.json

read -r SITE KEYID < <(node -e "const o=Object.values(require('./cdk-outputs.json'))[0];console.log(o.SiteUrl,o.ApiKeyId)")
KEY="$(aws apigateway get-api-key --api-key "$KEYID" --include-value --query value --output text --region "$REGION")"
echo
echo "================  BaadhMitra is live  ================"
echo "Dashboard : $SITE"
echo "API key   : $KEY    (paste it after pressing 'Connect to AWS')"
echo "Alerts    : subscribe an email via POST /subscribe, then confirm the AWS email"
echo "Metrics   : CloudWatch console > Dashboards > BaadhMitra"
