# Deploying for a real Bihar pilot

This is the checklist from "works in my AWS account" to "a district control room can use it". Everything below is a step you do; the code already supports it.

## 1. Pick the AWS region and account

- **Mumbai (`ap-south-1`) or Hyderabad (`ap-south-2`)** keeps data in India, which a government pilot will expect. Not every AWS account may use every region: some organisations restrict regions with an SCP. If CloudFormation or S3 returns `explicit deny in a service control policy`, that is your organisation's rule and has to be changed by its owner. Do not work around it.
- For a demo, any allowed region is fine (the prototype was deployed to `ap-southeast-2`). For a pilot, ask the department which account and region they require.
- Check that **Bedrock model access**, **Transcribe** and **Polly (Kajal, neural, hi-IN)** exist in the region you pick. Where one is missing the system keeps working: the offline extractor replaces Bedrock, and alerts go out as text without voice.

## 2. Deploy (Windows CMD)

```
git clone https://github.com/antrikakashyap/baadhmitra
cd baadhmitra
npm ci
npm run web:build
aws configure set region ap-south-1
npx cdk bootstrap
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json
```

Useful settings, added with `-c name=value`:

| Setting | Meaning |
| --- | --- |
| `modelId=<id>` | Bedrock model or inference-profile id you have access to |
| `gaugeFeedUrl=https://...` | official river-gauge JSON feed (see below). Without it, readings are simulated and labelled `sim` |
| `reportRps=50` | citizen intake rate limit per second (default 10). Raise for a real flood |
| `waf=true` | adds AWS WAF with managed rules and a per-IP cap (a monthly cost applies) |
| `pollMins=15` | gauge poll interval |

## 3. Create staff accounts (Windows CMD)

Nobody can sign up on their own. Replace `POOL` with the `UserPoolId` printed by the deploy and use real work emails.

```
aws cognito-idp admin-create-user --user-pool-id POOL --username officer@example.gov.in --user-attributes Name=email,Value=officer@example.gov.in Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id POOL --username officer@example.gov.in --group-name district_officer
```

AWS emails a temporary password. At first sign-in the dashboard asks for a new password of at least 12 characters.

| Group | Can do |
| --- | --- |
| `viewer` | see the queue, map, gauges, alerts |
| `control_room` | everything a viewer can, plus assign, resolve, dismiss |
| `district_officer` | everything above, plus replay failed messages, read the activity log, export dispatcher feedback |
| `field_team` | a rescue crew's own phone page only (`/field.html`): its assigned incidents, progress taps, optional location |

**Rescue crew accounts.** The crew's display name is what you pick in the dispatch dropdown, so set it with `Name=name` when creating the account (one account per crew, shared by that crew's phone):

```
aws cognito-idp admin-create-user --user-pool-id POOL --username crew1@example.gov.in --user-attributes Name=email,Value=crew1@example.gov.in Name=email_verified,Value=true Name=name,Value="NDRF Team A"
aws cognito-idp admin-add-user-to-group --user-pool-id POOL --username crew1@example.gov.in --group-name field_team
```

The crew signs in at `<SiteUrl>/field.html`. A crew shows on the dispatcher's team list and 3D map only after it has tapped "show my location" at least once in the last 12 hours.

Remove access with `aws cognito-idp admin-disable-user --user-pool-id POOL --username <email>`.

**Two-step sign-in:** optional MFA is enabled on the pool and each person can enrol an authenticator app from the dashboard (🔐 button); sign-in then asks for a code. Enrolment is voluntary and has not yet been exercised against a live pool, so test it with your own account first. Before a real pilot, decide whether to make it mandatory (set the pool's MFA to required) once everyone has enrolled.

## 4. Real river data

The poller reads one JSON URL shaped like this:

```json
[{"id":"gandhighat","name":"Gandhi Ghat","river":"Ganga","lat":25.61,"lon":85.20,"lvl":48.12,"danger":48.60,"ts":"2026-08-01T06:00:00Z"}]
```

- `lvl` and `danger` are metres in the same datum. `ts` is the observation time. Readings older than 3 hours are shown greyed out as stale and never raise a new alert.
- Implausible rows are dropped and counted (`FeedDropped` metric). If the feed is configured and unreachable, the system keeps the last real readings, marks them stale, and raises the `FeedDown` alarm. **It never falls back to simulated numbers once a real feed is configured.**
- Official sources (CWC, the Water Resources Department of Bihar, FMIS) publish in their own formats and may need data-sharing approval. Write a small adapter that outputs the shape above and host it where the poller can reach it. Getting that approval is a human task for the department.

## 5. Village-level lookup

The shipped gazetteer knows district headquarters and well-known flood towns. For village names, import a dataset you are licensed to use. One option is OpenStreetMap (ODbL licence: keep the attribution).

1. In Overpass Turbo (overpass-turbo.eu) run this for Bihar, then Export, Download as raw OSM data (JSON):
   ```
   [out:json][timeout:300];
   area["ISO3166-2"="IN-BR"]->.a;
   nwr(area.a)["place"~"^(village|hamlet)$"];
   out center;
   ```
   (`nwr` and `out center` also catch villages mapped as areas, not only points.)
2. In the repo: `npm run villages -- path\to\export.json` (or a CSV with columns `name,hi,lat,lon`).
3. `npm run web:build` and `npx cdk deploy`.

OSM village coverage in Bihar is uneven, and names are often spelled differently from the revenue records. Ask the department for the official village directory (Census or revenue code list) with coordinates for a better result. The matcher only accepts a name that is capitalised or sits next to a word like "me" or "gaon", and lowers confidence when several villages share a name.

## 6. WhatsApp

See `docs/WHATSAPP.md`. It needs a Meta business account and cannot be completed from code alone.

## 7. Before you go live

- [ ] Alarm emails: subscribe the control-room mailbox to the SNS topic (`TopicArn` output) and confirm the AWS email.
- [ ] Run `npm run loadtest -- <api url> 200 20 --yes` against a **staging** stack and read the CloudWatch dashboard.
- [ ] Walk through `docs/SOP.md` with the control room. Practise the "feed down" and "dead-letter queue" cases.
- [ ] Have `docs/PRIVACY.md` and `docs/SECURITY.md` reviewed by the department's legal and security teams.
- [ ] Confirm the emergency number shown to citizens (112) and the escalation contacts in the SOP.
