# Control-room runbook (draft)

For the people operating BaadhMitra in a flood control room. BaadhMitra ranks and suggests. **People decide and people dispatch.** It does not replace the emergency number 112 or any official procedure.

## Start of shift

1. Sign in on the dashboard. If your account shows "no role", ask the district officer to add you to a group.
2. Look at the river gauge bar. A grey card means the reading is old or the source has stopped updating: check the source by phone before trusting it.
3. A badge of `sim` on a reading means simulated data. **Never act on `sim`.**

## Working the queue

- The list is ordered by priority score (0 to 100). Open an incident to see how many independent people reported it, the people at risk, needs, and the original messages.
- `?` means the system is not confident. Read the messages and decide.
- **Assign** a team: it records who assigned and when. **Resolved** removes it from the queue. **Not real / duplicate** dismisses it; a new report from a different person re-opens it automatically.
- The header shows a count of **unplaced reports**: messages that could not be put on the map. Someone should read them (`GET /unplaced`; a list screen is not built into the dashboard yet) and place or forward them by hand.
- A score is a suggestion. Children, elderly, pregnancy and medical need raise it, but a reporter can be wrong in both directions.

## Overdue clock

Each queue row can show a badge such as `⏰ 22m`: amber is a warning, red is overdue. The header counts overdue incidents.

- *No team assigned:* urgent incidents (score 75+) warn at 15 min and are overdue at 30; others at 30 and 60.
- *Team gone silent:* an assigned incident with no word from the crew warns at 60 min and is overdue at 120.
- An overdue incident also sends one alert to the ops topic. Assigning a team, a crew update, or a new report restarts the clock. These times are starting values: agree them with your district and change `shared/sla.ts`.

## Rescue crews

Crews use `/field.html`. They see only their own incidents and tap *on the way*, *arrived*, *rescue complete*, or *nobody found*. *Complete* resolves the incident (shown as "closed by team"). *Nobody found* returns it to the queue marked for review: **read it again, do not just reassign blindly.** If a crew shows no position, it has not shared its location.

## Telling the system when it is wrong

Open an incident and answer *Did the system read this correctly?* If not, tick what was wrong (place, people, needs, severity). The **Report** button shows response times and how often you agreed. A district officer can export the verdicts. This is the honest way to measure accuracy, so please use it on real incidents.

## When something looks wrong

| Situation | Do this |
| --- | --- |
| Reports stop appearing | CloudWatch dashboard `BaadhMitra`: is the queue age rising? Is the dead-letter queue above 0? Ask a district officer to press replay (`POST /admin/replay`). |
| Gauge feed alarm | The source is down. Readings stay but are grey. Use the department's own gauge reports until it is back. |
| WhatsApp error alarm | Check the Meta token in Secrets Manager; Meta retries for a while. Citizens can still use the web page and 112. |
| Many near-identical reports from new senders | Possible spam. Open the incident, read the messages, dismiss if false. Tell the district officer (WAF can be turned on). |
| The dashboard is unreachable | Fall back to the existing manual process. Nothing about BaadhMitra should be the only path to a rescue. |

## Never

- Never promise a citizen that help is coming based on a report.
- Never paste raw reports with personal details into public chats.
- Never share your login.

## Review after each event

Open **Report** and the activity log (district officer), count reports, dismissed, resolved, and unplaced, and write down what the system got wrong. That list is the only honest accuracy measure.
