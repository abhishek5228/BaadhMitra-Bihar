# Privacy notes (draft for legal review)

This describes what the system does with personal data. It is written to help a department's legal team review the design. It is **not legal advice and not a compliance claim**. India's Digital Personal Data Protection Act, 2023 and its rules should be checked by counsel for the deploying body, which would be the data fiduciary, not this project.

## What is collected

| Data | Why | Kept |
| --- | --- | --- |
| Free text or voice note from the citizen | to find who needs rescue and where | report text 7 days; audio and transcripts 30 days |
| Optional location pin (browser or WhatsApp) | precise placement | used for the report; WhatsApp pin cached 2 hours |
| Sender identifier | to count independent reporters and rate-limit | a salted hash only. The raw phone number is never stored |
| Incident record (place, people, needs, snippets of redacted text) | the rescue queue | until the department resolves or deletes it; DynamoDB TTL can be configured |
| Staff email and actions | login and audit | audit about 400 days |
| Rescue crew position (only if the crew taps share) | show crews on the map and start boats from where they really are | latest position only, expires after 12 hours |
| Dispatcher feedback on an incident (verdict, which fields were wrong, redacted message snippets) | measure accuracy | about 400 days |

Phone numbers, Aadhaar-style 12-digit numbers, UPI ids and emails written inside a message are removed before storage and before any text goes to the language model. The redaction is rule based and can miss unusual formats.

## What is not done

- No advertising, no analytics trackers, no sale or sharing of data.
- The language model is used only to read the message; the report is not used to train anything by this project.
- No identification of individuals; the system is built around places and needs.

## Things the deploying body has to decide

- Legal basis and notice. The citizen pages say that the report goes to the control room and that no phone number is asked for; the department should add its own notice and grievance contact.
- Retention periods for incidents and audit records, and who may see snippets of free text.
- Where data may live (region) and which cloud providers are approved for it.
- Whether children's or sensitive information can appear in free text (it can: people describe illness and children). Access to snippets should be limited to dispatch staff.
- A process for deletion and correction requests.

## Defaults you can change in code

Retention is set in `backend/lib/intake.ts` (report text), `infra/lib/stack.ts` (S3 lifecycle) and `backend/lib/auth.ts` (audit).
