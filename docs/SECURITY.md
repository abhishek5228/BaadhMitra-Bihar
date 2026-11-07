# Security notes

An honest description of what protects the system and what does not yet. It is not a certification and has not been through an independent penetration test.

## What is in place

| Area | Control |
| --- | --- |
| Staff login | Cognito user pool, no self sign-up, 12+ character passwords, one-hour tokens, role groups checked **on the server** for every call (hiding a button is only a courtesy) |
| Roles | `viewer` read only; `control_room` can assign, resolve, dismiss; `district_officer` can also replay the dead-letter queue and read the activity log |
| Field crews | Own Cognito group `field_team`. It can call only `/field/*`, and only incidents assigned to the crew's own team name can be changed by it. Staff roles cannot call crew routes and crews cannot read the queue |
| Location | Crew location is shared only when the crew taps share, only while the page is open, rounded to the device's reported position, and expires after 12 hours |
| Audit | Every assign, resolve, dismiss and replay writes an append-only record (who, what, when, which incident) kept about 400 days |
| Public endpoints | Only citizen intake (`/reports`, `/upload-url`, `/subscribe`) and the signed WhatsApp webhook. Request validation, per-route throttles, per-sender hourly limit, optional WAF (`-c waf=true`) |
| WhatsApp | HMAC signature check on the raw body, refuses all traffic if the secret is missing, secrets in Secrets Manager |
| Data | Encrypted at rest (DynamoDB, S3), TLS enforced on buckets and queues, public access blocked on every bucket, point-in-time recovery, table retained on stack deletion |
| Least privilege | One IAM role per Lambda with only the actions it uses |
| Untrusted text | Reports are redacted of phone numbers, Aadhaar-style numbers, UPI ids and emails, validated, and rendered in the browser with `textContent` only. The language model can only produce validated data; nothing it writes triggers an action |
| Spam | Reporter counting uses hashed sender ids so one phone cannot inflate an incident; a person can dismiss an incident and a new independent report re-opens it |
| Fake data | With a real gauge feed configured the simulator is never used; stale readings are marked and raise no alerts |
| Ops | CloudWatch alarms for the dead-letter queue, queue age, extractor and WhatsApp errors, and a down gauge feed. X-Ray tracing on |

## Known gaps (do these before a real pilot)

1. **Two-step sign-in is opt-in per person.** Staff can enrol an authenticator app from the dashboard (🔐 button), after which the sign-in asks for a code. It is not yet *required* for every account, and the enrolment screen has been unit-tested against a fake Cognito but not against a live pool. The access token it needs is kept in the same tab-scoped storage as the ID token.
2. **CORS** allows any origin by default so the demo works anywhere. For a pilot deploy with `-c corsOrigin=https://<your-cloudfront-domain>` to restrict the API, error responses and audio upload to the dashboard origin.
3. **Public report endpoint** can be abused with many fake senders from many IPs. The API throttle bounds the damage and the review queue holds low-confidence incidents, but a determined attacker can still add noise. Use the WAF and watch the `RateLimited` and `Unplaced` metrics.
4. **`/subscribe`** lets anyone ask AWS to send a confirmation email to an address. It is throttled to 1 request per second; consider removing it from the public API and subscribing control-room staff directly.
5. No independent penetration test, no formal threat model review, no dependency scanning beyond CI.
6. SMS alerts in India need DLT registration; only email works out of the box.
7. Crew accounts are shared per team, so the audit trail shows the team, not the individual. Issue one account per person if you need individual accountability.
8. Cognito tokens are kept in `sessionStorage`, so a cross-site scripting bug would expose them. The app avoids `innerHTML`, and CloudFront sends security headers, but a strict Content Security Policy is not set yet.

## Reporting a problem

Open a private security advisory on the GitHub repository rather than a public issue.
