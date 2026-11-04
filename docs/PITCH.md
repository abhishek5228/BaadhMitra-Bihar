# BaadhMitra · बाढ़मित्र: one page

**Problem.** In a flood, control rooms receive calls and WhatsApp voice notes in Hindi and dialects. They are duplicated, unstructured and mostly lack coordinates. Rescue order depends on who is loudest. Early warnings reach villages late and in a form many cannot read.

**What it is.** A serverless system on AWS that turns Hindi/Hinglish text and voice reports into one ranked, de-duplicated rescue queue on a 3D map, and sends river-level warnings with a Hindi voice message.

**How it works.**
1. Citizens report by a phone-friendly page that works offline, or by WhatsApp (Meta approval needed), by text, voice or location pin.
2. Amazon Transcribe and Amazon Bedrock read the message. A rule-based Hindi extractor takes over if the model is unavailable.
3. Reports from the same area merge into one incident. Priority weighs severity, independent reporters, people at risk, vulnerable people and medical need.
4. Control-room staff sign in with roles, assign boats, and every action is logged.
5. A gauge poller raises early warnings; old data is greyed out and never alerts.

**Why it is safe to try.**
- Human dispatches; the system only ranks.
- Runs in parallel with the existing process.
- Degrades instead of failing: offline extractor, dead-letter queue and replay, alarms.
- No phone numbers stored; short retention; roles; audit trail.
- Honest about limits: simulated gauges are labelled, accuracy on real messages is unmeasured until a pilot.

**What a pilot needs from the department.** A nodal officer, an AWS account and region, a river-gauge feed, a village directory, a WhatsApp Business number, legal/security review. See `PILOT.md`.

**Built so far.** Working prototype, automated tests, infrastructure as code, deployed by its author to a personal AWS account for testing. Not yet used in a real flood.

**Cost.** Pay-per-use serverless. Estimate with the AWS Pricing Calculator for your expected reports per day; measure it in the pilot from the real bill.

**Contact.** Abhishek Kumar · github.com/antrikakashyap/baadhmitra
