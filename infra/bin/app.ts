import * as cdk from 'aws-cdk-lib'
import { BaadhMitraStack } from '../lib/stack'

const app = new cdk.App()
new BaadhMitraStack(app, 'BaadhMitra', {
  // Mumbai by default: closest to Bihar (lowest latency, and data stays in India).
  // Check Bedrock model access, Transcribe and Polly (Kajal, neural, hi-IN) in your chosen region.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1' },
  description: 'BaadhMitra: vernacular flood-rescue triage for Bihar',
})
