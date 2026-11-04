# Pilot proposal (draft)

A small, bounded way for one district to try BaadhMitra without depending on it.

## Scope

- **One district** that floods regularly (for example one of the Kosi-basin districts), one control room, 3 to 10 staff accounts.
- **Parallel run only.** The existing process stays the source of truth. BaadhMitra runs beside it, and the control room compares.
- **Two phases:**
  1. *Dry run (2 to 3 weeks, before monsoon):* staff send invented reports, practise the SOP, test the feed adapter and alarms, run the load test on staging.
  2. *Live shadow (monsoon season):* citizens can use the web page and WhatsApp number. Staff use the queue as a second opinion.

## What the department provides

| Item | Why |
| --- | --- |
| A named nodal officer | someone who can say yes/no and receive alarms |
| An AWS account and region decision | data residency and approvals |
| A river gauge data source (and permission) | real early warning instead of the simulator |
| The village directory with coordinates | village-level placement |
| A WhatsApp Business number | Meta approval needs the organisation |
| A legal/IT security review | see `PRIVACY.md` and `SECURITY.md` |
| Review of Hindi/Bhojpuri/Maithili vocabulary by native speakers | the dialect word list is best effort |

## What the project provides

The deployed system, the runbook, training for control-room staff, a weekly review of what the system got wrong, and fixes during the pilot.

## What to measure (all from the system's own logs, nothing assumed)

- Time from report received to appearing in the queue.
- Share of reports placed automatically vs sent to `unplaced`.
- Share of incidents a dispatcher dismissed as false or duplicate.
- Share of high-priority incidents where the dispatcher agreed with the score. A dispatcher can mark disagreement in the weekly review; this builds the real labelled set the benchmark needs.
- Queue age and dead-letter queue depth during peak load.
- Cost for the period, from the AWS bill.

**Success is decided by the control room**, for example: staff say the queue saved them time, false-positive rate is tolerable, nothing was lost. Missing the goal is a useful result too.

## Risks and how they are handled

| Risk | Handling |
| --- | --- |
| Wrong ranking sends boats late | human dispatches; parallel run; SOP says the score is a suggestion |
| Fake or spam reports | independent reporter counting, rate limits, dismiss and re-open, optional WAF |
| Stale or simulated river data mistaken for real | `sim` and stale labels, no simulation once a real feed is configured, alarm |
| System outage | the manual process stays; SOP fallback rows |
| Privacy | redaction, hashing, short retention, legal review (see `PRIVACY.md`) |
| People believe a report guarantees rescue | citizen page and WhatsApp replies say it does not and show 112 |

## Not claimed

No deployment in a real flood has happened. No agency has endorsed or approved this. The accuracy of extraction on real messages is **unmeasured** until the pilot produces labelled data.
