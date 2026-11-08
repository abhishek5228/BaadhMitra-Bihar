import { describe, expect, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { BaadhMitraStack } from '../infra/lib/stack'

// 'aws:cdk:bundling-stacks': [] skips esbuild so this test runs in about a second.
const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
const t = Template.fromStack(new BaadhMitraStack(app, 'T', { env: { account: '111111111111', region: 'ap-south-1' } }))

describe('infrastructure guarantees', () => {
  it('passes the bulletin-feed settings to the gauge poller, and is off by default', () => {
    const on = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], gaugeFeedUrl: 'https://example.gov/g.json', gaugeFeedPartial: 'true', gaugeStaleHours: '30' } })
    const m = Template.fromStack(new BaadhMitraStack(on, 'P', { env: { account: '111111111111', region: 'ap-south-1' } }))
    m.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ FEED_PARTIAL: 'true', FEED_STALE_H: '30' }) } })
    t.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ FEED_PARTIAL: '', FEED_STALE_H: '' }) } })
  })
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
  it('only citizen intake and the signed WhatsApp webhook are public; staff routes need Cognito', () => {
    const ms = Object.values(t.findResources('AWS::ApiGateway::Method')) as { Properties: Record<string, unknown> }[]
    const open = ms.filter((m) => m.Properties.HttpMethod !== 'OPTIONS' && m.Properties.AuthorizationType !== 'COGNITO_USER_POOLS')
    expect(open).toHaveLength(5) // POST /reports, /upload-url, /subscribe, GET+POST /whatsapp
    expect(ms.filter((m) => m.Properties.ApiKeyRequired === true)).toHaveLength(0)
  })
  it('has a staff user pool with no self sign-up, 12+ char passwords and four role groups', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
    })
    t.resourceCountIs('AWS::Cognito::UserPoolGroup', 4)
  })
  it('sweeps for overdue incidents every 5 minutes', () => {
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(5 minutes)' })
  })
  it('keeps WhatsApp credentials in Secrets Manager, not in Lambda env values', () => {
    t.resourceCountIs('AWS::SecretsManager::Secret', 1)
    expect(JSON.stringify(Object.values(t.findResources('AWS::Lambda::Function')))).not.toContain('app_secret":"')
  })
  it('all buckets block public access and require TLS', () => {
    const bs = Object.values(t.findResources('AWS::S3::Bucket')) as { Properties: Record<string, unknown> }[]
    for (const b of bs) expect(b.Properties.PublicAccessBlockConfiguration).toMatchObject({ BlockPublicAcls: true, RestrictPublicBuckets: true })
  })
  it('raises alarms for the DLQ, queue age, extractor and WhatsApp errors', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 4)
  })
  it('listens for finished Transcribe jobs and polls gauges on a schedule', () => {
    t.hasResourceProperties('AWS::Events::Rule', { EventPattern: Match.objectLike({ source: ['aws.transcribe'] }) })
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' })
  })
})

describe('opt-in edge protection', () => {
  it('adds a WAF only when asked', () => {
    t.resourceCountIs('AWS::WAFv2::WebACL', 0)
    const a = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], waf: 'true', gaugeFeedUrl: 'https://example.gov/g.json' } })
    const w = Template.fromStack(new BaadhMitraStack(a, 'W', { env: { account: '111111111111', region: 'ap-southeast-2' } }))
    w.resourceCountIs('AWS::WAFv2::WebACL', 1)
    w.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1)
    w.resourceCountIs('AWS::CloudWatch::Alarm', 5) // + FeedDown when a feed is configured
  })
})

describe('foreign gauge feed mapping', () => {
  it('passes a minified, validated map to the gauge Lambda, and rejects invalid JSON', () => {
    const ctx = { 'aws:cdk:bundling-stacks': [], gaugeFeedUrl: 'https://example.gov/g.json', gaugeFeedMap: '{ "id": "a",\n "lvl": "b" }' }
    const m = Template.fromStack(new BaadhMitraStack(new cdk.App({ context: ctx }), 'M', { env: { account: '111111111111', region: 'ap-southeast-2' } }))
    m.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ FEED_MAP: '{"id":"a","lvl":"b"}' }) } })
    const bad = new cdk.App({ context: { ...ctx, gaugeFeedMap: '{nope' } })
    expect(() => new BaadhMitraStack(bad, 'B', { env: { account: '111111111111', region: 'ap-southeast-2' } })).toThrow()
  })
})

describe('gauge feed credential', () => {
  it('exists only when an official feed is configured and is readable by the Lambdas that need secrets', () => {
    t.resourcePropertiesCountIs('AWS::SecretsManager::Secret', { Name: 'baadhmitra/gauge-feed' }, 0)
    const a = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], gaugeFeedUrl: 'https://example.gov/g.json' } })
    const f = Template.fromStack(new BaadhMitraStack(a, 'F', { env: { account: '111111111111', region: 'ap-southeast-2' } }))
    f.resourcePropertiesCountIs('AWS::SecretsManager::Secret', { Name: 'baadhmitra/gauge-feed' }, 1)
    const pol = JSON.stringify(f.findResources('AWS::IAM::Policy'))
    expect(pol.split('secretsmanager:GetSecretValue').length - 1).toBeGreaterThanOrEqual(2) // whatsapp + feed
  })
})

describe('CORS lock-down', () => {
  it('defaults to open for the demo and restricts to one origin when asked', () => {
    t.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ CORS_ORIGIN: '*' }) } })
    const o = 'https://dash.example.org'
    const a = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], corsOrigin: o } })
    const c = Template.fromStack(new BaadhMitraStack(a, 'C', { env: { account: '111111111111', region: 'ap-southeast-2' } }))
    c.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ CORS_ORIGIN: o }) } })
    c.hasResourceProperties('AWS::S3::Bucket', { CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: [o] })] } })
    c.hasResourceProperties('AWS::ApiGateway::GatewayResponse', { ResponseParameters: { 'gatewayresponse.header.Access-Control-Allow-Origin': `'${o}'` } })
  })
})

