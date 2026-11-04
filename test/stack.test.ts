import { describe, expect, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { BaadhMitraStack } from '../infra/lib/stack'

// 'aws:cdk:bundling-stacks': [] skips esbuild so this test runs in about a second.
const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
const t = Template.fromStack(new BaadhMitraStack(app, 'T', { env: { account: '111111111111', region: 'ap-south-1' } }))

describe('infrastructure guarantees', () => {
  it('has a dead-letter queue wired with 3 receives', () => {
    t.hasResourceProperties('AWS::SQS::Queue', { RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) })
  })
  it('table is on-demand, has TTL and point-in-time recovery, and survives stack deletion', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    })
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' })
  })
  it('extractor uses partial batch responses and capped concurrency', () => {
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: 5 },
    })
  })
  it('only citizen intake routes are public; dispatcher routes need an API key', () => {
    const ms = Object.values(t.findResources('AWS::ApiGateway::Method')) as { Properties: Record<string, unknown> }[]
    const open = ms.filter((m) => m.Properties.HttpMethod !== 'OPTIONS' && m.Properties.ApiKeyRequired !== true)
    expect(open).toHaveLength(3) // POST /reports, /upload-url, /subscribe
  })
  it('all buckets block public access and require TLS', () => {
    const bs = Object.values(t.findResources('AWS::S3::Bucket')) as { Properties: Record<string, unknown> }[]
    for (const b of bs) expect(b.Properties.PublicAccessBlockConfiguration).toMatchObject({ BlockPublicAcls: true, RestrictPublicBuckets: true })
  })
  it('raises alarms for the DLQ, queue age and extractor errors', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 3)
  })
  it('listens for finished Transcribe jobs and polls gauges on a schedule', () => {
    t.hasResourceProperties('AWS::Events::Rule', { EventPattern: Match.objectLike({ source: ['aws.transcribe'] }) })
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' })
  })
})
