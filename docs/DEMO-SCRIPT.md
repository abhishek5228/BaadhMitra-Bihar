# Demo script (5 minutes)

Use the live site if deployed, otherwise run `npm run web` for the offline demo (add `?demo=1` to the URL of a deployed site to see the same offline mode).

**0:00 The problem (30 s).** "In a flood, a control room gets hundreds of voice notes like *paani ghar mein ghus gaya, bachche chhat pe hain*. No coordinates, many duplicates. Who gets the boat first?"

**0:30 The map (30 s).** Show the 3D Bihar map and the rescue queue. "Each beacon is an incident, not a message. Twenty reports from Supaul are one incident."

**1:00 A report arrives (60 s).** Open `/report.html` on a phone (or the composer). Type: *Supaul me kamar tak paani, 12 log, naav chahiye*. Watch it appear. Open the incident: "It merged with other reports, found 12 people, boat need, and the score explains why."

**2:00 Offline (45 s).** On the phone page switch to airplane mode, send a report: "It is saved on the phone and goes when the network returns." Turn the network on; it is delivered.

**2:45 Roles and audit (45 s).** Sign in as a `control_room` user: assign a team. Sign in as a `viewer`: the buttons are read-only. As `district_officer`, open the **Activity log**: who did what, when.

**3:30 Early warning (45 s).** Press **Simulate monsoon surge** (demo) or show a real feed: gauges rise, water rises, a Hindi alert plays. Point at a grey gauge: "Old data is greyed and never alerts. Simulated data is labelled `sim`."

**4:15 What can go wrong (30 s).** "Bedrock down? Rule extractor takes over (dashboard shows the fallback count). Bad message? Dead-letter queue and replay. Spam? One phone counts once; dismiss and it re-opens only on new independent evidence."

**4:45 The ask (15 s).** "A one-district shadow pilot. We need a nodal officer, a gauge feed, a village list and a WhatsApp number. The control room decides whether it helps."

**Do not say:** that it has been used in a real flood, that any agency endorsed it, or quote accuracy numbers from the starter benchmark.
