import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ddb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as s3d from 'aws-cdk-lib/aws-s3-deployment'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as lam from 'aws-cdk-lib/aws-lambda'
import * as les from 'aws-cdk-lib/aws-lambda-event-sources'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as api from 'aws-cdk-lib/aws-apigateway'
import * as ev from 'aws-cdk-lib/aws-events'
import * as tg from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cw from 'aws-cdk-lib/aws-cloudwatch'
import * as cwa from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as cf from 'aws-cdk-lib/aws-cloudfront'
import * as org from 'aws-cdk-lib/aws-cloudfront-origins'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cog from 'aws-cdk-lib/aws-cognito'
import * as sm from 'aws-cdk-lib/aws-secretsmanager'
import * as waf from 'aws-cdk-lib/aws-wafv2'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export class BaadhMitraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const model: string = this.node.tryGetContext('modelId') ?? 'anthropic.claude-3-haiku-20240307-v1:0'
    const poll: number = Number(this.node.tryGetContext('pollMins') ?? 15)
    const feed: string = this.node.tryGetContext('gaugeFeedUrl') ?? ''
    // Field mapping for a foreign feed: a file path (works in any shell, incl. Windows CMD) or the JSON text itself. See docs/DATA-REQUEST.md
    const mapFile: string = this.node.tryGetContext('gaugeFeedMapFile') ?? ''
    const mapText: string = mapFile ? readFileSync(path.resolve(mapFile), 'utf-8') : (this.node.tryGetContext('gaugeFeedMap') ?? '')
    const feedMap: string = mapText ? JSON.stringify(JSON.parse(mapText)) : '' // fails the deploy early on invalid JSON
    const rps = Number(this.node.tryGetContext('reportRps') ?? 10) // citizen intake throughput; raise for a real flood
    // Browser origin allowed to call the API and upload audio. '*' keeps the demo working anywhere; for a pilot pass the dashboard origin: -c corsOrigin=https://xxxx.cloudfront.net
    const origin: string = this.node.tryGetContext('corsOrigin') ?? '*'
    const useWaf = String(this.node.tryGetContext('waf') ?? 'false') === 'true'

    // ---------------------------------------------------------------- data
    // Single table. pk/sk addressing plus one GSI (gsi1) that serves every "list" screen:
    // ranked incidents, gauges, alerts, unplaced reports.
    const tbl = new ddb.Table(this, 'Tbl', {
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN, // rescue data is never auto-deleted with the stack
    })
    tbl.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'g1p', type: ddb.AttributeType.STRING },
      sortKey: { name: 'g1s', type: ddb.AttributeType.STRING },
    })

    const bkt = new s3.Bucket(this, 'Bkt', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [origin], allowedHeaders: ['*'], maxAge: 3000 }],
      lifecycleRules: [
        { prefix: 'audio/', expiration: cdk.Duration.days(30) },
        { prefix: 'transcripts/', expiration: cdk.Duration.days(30) },
        { prefix: 'alerts/', expiration: cdk.Duration.days(90) },
      ],
    })

    const top = new sns.Topic(this, 'Top', { displayName: 'BaadhMitra alerts' })

    // ---------------------------------------------------------------- queues
    const dlq = new sqs.Queue(this, 'Dlq', { retentionPeriod: cdk.Duration.days(14), enforceSSL: true })
    const que = new sqs.Queue(this, 'Que', {
      visibilityTimeout: cdk.Duration.seconds(180), // > 6x the extractor timeout, as AWS recommends
      retentionPeriod: cdk.Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    })

    // ---------------------------------------------------------------- identity
    // Dispatchers sign in with Cognito. No self sign-up: an administrator creates each account and
    // puts it in one group (district_officer, control_room or viewer). The API checks the group.
    const pool = new cog.UserPool(this, 'Pool', {
      userPoolName: 'baadhmitra-staff',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      mfa: cog.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cog.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    for (const g of ['district_officer', 'control_room', 'viewer', 'field_team']) new cog.CfnUserPoolGroup(this, 'Grp' + g, { userPoolId: pool.userPoolId, groupName: g })
    const client = pool.addClient('Web', {
      authFlows: { userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
    })

    // WhatsApp credentials live in Secrets Manager, never in code or env vars. Fill in after Meta approval.
    const waSecret = new sm.Secret(this, 'Wa', {
      secretName: 'baadhmitra/whatsapp',
      description: 'Meta WhatsApp Cloud API: verify_token, app_secret, access_token, phone_id',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ verify_token: '', app_secret: '', access_token: '', phone_id: '' })),
    })

    // ---------------------------------------------------------------- functions
    const env = { TBL: tbl.tableName, QURL: que.queueUrl, Q_ARN: que.queueArn, DLQ_ARN: dlq.queueArn, BKT: bkt.bucketName, TOPIC: top.topicArn, MODEL: model, FEED: feed, FEED_MAP: feedMap, CORS_ORIGIN: origin, SALT: cdk.Fn.select(2, cdk.Fn.split('/', this.stackId)), WA_SECRET: waSecret.secretArn }
    const fn = (name: string, entry: string, handler: string, o: { mem?: number; secs?: number } = {}) =>
      new NodejsFunction(this, name, {
        entry: path.join(ROOT, 'backend', entry),
        handler,
        runtime: lam.Runtime.NODEJS_22_X,
        architecture: lam.Architecture.ARM_64,
        memorySize: o.mem ?? 256,
        timeout: cdk.Duration.seconds(o.secs ?? 15),
        tracing: lam.Tracing.ACTIVE,
        environment: env,
        logGroup: new logs.LogGroup(this, name + 'Lg', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
        bundling: { minify: true, sourceMap: true, target: 'node22', externalModules: [] },
      })

    const fIn = fn('Ingest', 'ingest.ts', 'handler')
    const fEx = fn('Extract', 'extract.ts', 'handler', { mem: 512, secs: 30 })
    const fApi = fn('Dash', 'api.ts', 'handler')
    const fVs = fn('VoiceStart', 'voice.ts', 'onAudio')
    const fVd = fn('VoiceDone', 'voice.ts', 'onDone')
    const fGa = fn('Gauge', 'gauge.ts', 'handler', { secs: 60 })
    const fWa = fn('Whatsapp', 'wa.ts', 'handler', { secs: 25 })
    const fSl = fn('Sla', 'sla.ts', 'handler', { secs: 30 })

    // least privilege, function by function
    for (const f of [fIn, fEx, fApi, fVd, fGa, fWa, fSl]) tbl.grantReadWriteData(f)
    que.grantSendMessages(fIn)
    que.grantSendMessages(fVd)
    bkt.grantPut(fIn)
    bkt.grantPut(fWa)
    que.grantSendMessages(fWa)
    waSecret.grantRead(fWa)
    bkt.grantRead(fApi)
    bkt.grantReadWrite(fVs)
    bkt.grantRead(fVd)
    bkt.grantPut(fGa)
    top.grantPublish(fEx)
    top.grantPublish(fGa)
    top.grantPublish(fSl)
    fApi.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Subscribe'], resources: [top.topicArn] }))
    fApi.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:StartMessageMoveTask', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
        resources: [dlq.queueArn],
      }),
    )
    que.grantSendMessages(fApi) // redrive destination
    fVs.addToRolePolicy(new iam.PolicyStatement({ actions: ['transcribe:StartTranscriptionJob'], resources: ['*'] }))
    fGa.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }))
    const mid = model.replace(/^(us|eu|apac|us-gov|global)\./, '')
    fEx.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:*::foundation-model/${mid}`, `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    )

    // SQS -> extractor: small batches, capped concurrency (protects Bedrock quota and the bill)
    fEx.addEventSource(new les.SqsEventSource(que, { batchSize: 5, maxBatchingWindow: cdk.Duration.seconds(2), reportBatchItemFailures: true, maxConcurrency: 5 }))

    // voice: S3 upload -> Transcribe; Transcribe done (EventBridge) -> same queue as text
    bkt.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(fVs), { prefix: 'audio/' })
    new ev.Rule(this, 'TrDone', {
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'], TranscriptionJobName: [{ prefix: 'bm-' }] },
      },
      targets: [new tg.LambdaFunction(fVd, { retryAttempts: 2 })],
    })

    // overdue sweep: unassigned or silent incidents are escalated once per level
    new ev.Rule(this, 'Sweep', { schedule: ev.Schedule.rate(cdk.Duration.minutes(5)), targets: [new tg.LambdaFunction(fSl)] })

    // early warning: poll gauges on a schedule
    new ev.Rule(this, 'Poll', { schedule: ev.Schedule.rate(cdk.Duration.minutes(poll)), targets: [new tg.LambdaFunction(fGa)] })

    // ---------------------------------------------------------------- API
    const rest = new api.RestApi(this, 'Api', {
      restApiName: 'baadhmitra',
      cloudWatchRole: false, // do not overwrite the account-wide API Gateway logging role
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        metricsEnabled: true,
        throttlingRateLimit: 30,
        throttlingBurstLimit: 60,
        methodOptions: {
          '/reports/POST': { throttlingRateLimit: rps, throttlingBurstLimit: rps * 2 },
          '/whatsapp/POST': { throttlingRateLimit: rps, throttlingBurstLimit: rps * 2 },
          '/upload-url/POST': { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
          '/subscribe/POST': { throttlingRateLimit: 1, throttlingBurstLimit: 3 }, // each call can email a stranger a confirmation
        },
      },
      defaultCorsPreflightOptions: { allowOrigins: origin === '*' ? api.Cors.ALL_ORIGINS : [origin], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] },
    })
    // Errors raised by API Gateway itself (wrong or missing key, throttling, validation) must still carry
    // CORS headers, otherwise the browser hides the real status behind a generic network error.
    const cors = { 'Access-Control-Allow-Origin': `'${origin}'` }
    rest.addGatewayResponse('Gw4xx', { type: api.ResponseType.DEFAULT_4XX, responseHeaders: cors })
    rest.addGatewayResponse('Gw5xx', { type: api.ResponseType.DEFAULT_5XX, responseHeaders: cors })
    const lamIn = new api.LambdaIntegration(fIn)
    const lamApi = new api.LambdaIntegration(fApi)
    const lamWa = new api.LambdaIntegration(fWa)
    const auth = new api.CognitoUserPoolsAuthorizer(this, 'Auth', { cognitoUserPools: [pool], identitySource: 'method.request.header.Authorization' })
    const keyed = { authorizer: auth, authorizationType: api.AuthorizationType.COGNITO }

    const repModel = rest.addModel('Rep', {
      contentType: 'application/json',
      schema: {
        schema: api.JsonSchemaVersion.DRAFT4,
        type: api.JsonSchemaType.OBJECT,
        required: ['text'],
        properties: {
          text: { type: api.JsonSchemaType.STRING, minLength: 3, maxLength: 1000 },
          sender: { type: api.JsonSchemaType.STRING, maxLength: 80 },
          lat: { type: api.JsonSchemaType.NUMBER },
          lon: { type: api.JsonSchemaType.NUMBER },
        },
        additionalProperties: false,
      },
    })
    const val = rest.addRequestValidator('Val', { validateRequestBody: true })

    // public citizen endpoints (rate limited, validated)
    rest.root.addResource('reports').addMethod('POST', lamIn, { requestModels: { 'application/json': repModel }, requestValidator: val })
    rest.root.addResource('upload-url').addMethod('POST', lamIn)
    rest.root.addResource('subscribe').addMethod('POST', lamApi)
    const wa = rest.root.addResource('whatsapp') // Meta calls this; authenticity is checked by signature inside the Lambda
    wa.addMethod('GET', lamWa)
    wa.addMethod('POST', lamWa)

    // dispatcher endpoints need the API key
    const inc = rest.root.addResource('incidents')
    inc.addMethod('GET', lamApi, keyed)
    const one = inc.addResource('{id}')
    one.addResource('assign').addMethod('POST', lamApi, keyed)
    one.addResource('resolve').addMethod('POST', lamApi, keyed)
    one.addResource('dismiss').addMethod('POST', lamApi, keyed)
    one.addResource('feedback').addMethod('POST', lamApi, keyed)
    for (const p of ['gauges', 'alerts', 'stats', 'unplaced']) rest.root.addResource(p).addMethod('GET', lamApi, keyed)
    rest.root.addResource('admin').addResource('replay').addMethod('POST', lamApi, keyed)
    rest.root.addResource('audit').addMethod('GET', lamApi, keyed)
    for (const p of ['teams', 'metrics', 'feedback']) rest.root.addResource(p).addMethod('GET', lamApi, keyed)
    // field teams: a rescue crew's own phone (role field_team, checked in the Lambda)
    const fld = rest.root.addResource('field')
    fld.addResource('ping').addMethod('POST', lamApi, keyed)
    fld.addResource('mine').addMethod('GET', lamApi, keyed)
    fld.addResource('{id}').addResource('progress').addMethod('POST', lamApi, keyed)

    // Optional edge protection (about USD 10 a month): AWS managed rules plus a per-IP rate cap.
    if (useWaf) {
      const vis = (n: string) => ({ sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: n })
      const acl = new waf.CfnWebACL(this, 'Acl', {
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: vis('baadhmitra'),
        rules: [
          { name: 'ipcap', priority: 0, action: { block: {} }, statement: { rateBasedStatement: { limit: 600, aggregateKeyType: 'IP' } }, visibilityConfig: vis('ipcap') },
          { name: 'common', priority: 1, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' } }, visibilityConfig: vis('common') },
        ],
      })
      new waf.CfnWebACLAssociation(this, 'AclLink', { resourceArn: rest.deploymentStage.stageArn, webAclArn: acl.attrArn })
    }

    // ---------------------------------------------------------------- observability
    const mt = (n: string, stat = 'Sum', per = 5) => new cw.Metric({ namespace: 'BaadhMitra', metricName: n, statistic: stat, period: cdk.Duration.minutes(per) })
    const dash = new cw.Dashboard(this, 'Board', { dashboardName: 'BaadhMitra' })
    dash.addWidgets(
      new cw.GraphWidget({ title: 'Reports in vs duplicates vs fallback', left: [mt('ReportsIn'), mt('DuplicateReports'), mt('FallbackUsed'), mt('Unplaced')], width: 12 }),
      new cw.GraphWidget({ title: 'Bedrock latency (p50 / p95 ms)', left: [mt('BedrockMs', 'p50'), mt('BedrockMs', 'p95')], width: 12 }),
    )
    dash.addWidgets(
      new cw.GraphWidget({ title: 'Extraction confidence (avg)', left: [mt('Confidence', 'Average')], width: 8 }),
      new cw.GraphWidget({ title: 'Queue depth and age', left: [que.metricApproximateNumberOfMessagesVisible(), dlq.metricApproximateNumberOfMessagesVisible()], right: [que.metricApproximateAgeOfOldestMessage()], width: 8 }),
      new cw.GraphWidget({ title: 'Alerts raised / gauge polls', left: [mt('AlertsRaised'), mt('GaugePolls')], width: 4 }),
      new cw.GraphWidget({ title: 'Overdue incidents (warn / breach)', left: [mt('SlaWarn', 'Maximum'), mt('SlaBreach', 'Maximum')], width: 4 }),
    )
    dash.addWidgets(
      new cw.GraphWidget({ title: 'API 4xx / 5xx', left: [rest.metricClientError(), rest.metricServerError()], width: 12 }),
      new cw.GraphWidget({ title: 'API latency p95', left: [rest.metricLatency({ statistic: 'p95' })], width: 12 }),
      new cw.GraphWidget({ title: 'Lambda errors', left: [fIn, fEx, fApi, fVd, fGa, fWa, fSl].map((f) => f.metricErrors()), width: 24 }),
    )

    const act = new cwa.SnsAction(top)
    const a1 = new cw.Alarm(this, 'DlqAlarm', { alarmDescription: 'Reports are failing into the dead-letter queue. Replay with POST /admin/replay.', metric: dlq.metricApproximateNumberOfMessagesVisible(), threshold: 1, evaluationPeriods: 1, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD })
    const a2 = new cw.Alarm(this, 'AgeAlarm', { alarmDescription: 'Reports are waiting more than 5 minutes.', metric: que.metricApproximateAgeOfOldestMessage(), threshold: 300, evaluationPeriods: 2 })
    const a3 = new cw.Alarm(this, 'ExtractErr', { alarmDescription: 'Extractor Lambda errors', metric: fEx.metricErrors({ period: cdk.Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1, treatMissingData: cw.TreatMissingData.NOT_BREACHING })
    const a4 = new cw.Alarm(this, 'WaErr', { alarmDescription: 'WhatsApp webhook Lambda errors: Meta will retry, but check the secret and token.', metric: fWa.metricErrors({ period: cdk.Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1, treatMissingData: cw.TreatMissingData.NOT_BREACHING })
    const alarms = [a1, a2, a3, a4]
    if (feed) {
      // Only meaningful with a real feed: silence here means river levels on screen are going stale.
      alarms.push(new cw.Alarm(this, 'FeedDown', { alarmDescription: 'Official gauge feed unreachable or invalid. Dashboard shows last readings marked stale.', metric: mt('FeedDown', 'Sum', 15), threshold: 1, evaluationPeriods: 2, treatMissingData: cw.TreatMissingData.NOT_BREACHING }))
    }
    for (const a of alarms) a.addAlarmAction(act)

    // ---------------------------------------------------------------- 3D dashboard hosting
    const site = new s3.Bucket(this, 'Site', { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true, removalPolicy: cdk.RemovalPolicy.DESTROY, autoDeleteObjects: true })
    const cdn = new cf.Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: org.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
    })
    const dist = path.join(ROOT, 'web', 'dist')
    if (existsSync(dist)) {
      new s3d.BucketDeployment(this, 'Web', {
        sources: [s3d.Source.asset(dist), s3d.Source.jsonData('config.json', { api: rest.url, region: this.region, clientId: client.userPoolClientId, poolId: pool.userPoolId })],
        destinationBucket: site,
        distribution: cdn,
        distributionPaths: ['/*'],
      })
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: rest.url })
    new cdk.CfnOutput(this, 'UserPoolId', { value: pool.userPoolId })
    new cdk.CfnOutput(this, 'ClientId', { value: client.userPoolClientId })
    new cdk.CfnOutput(this, 'WaSecret', { value: waSecret.secretName, description: 'fill in after Meta approval, see docs/WHATSAPP.md' })
    new cdk.CfnOutput(this, 'SiteUrl', { value: 'https://' + cdn.distributionDomainName })
    new cdk.CfnOutput(this, 'TopicArn', { value: top.topicArn })
    new cdk.CfnOutput(this, 'DlqUrl', { value: dlq.queueUrl })
  }
}
