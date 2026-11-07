# Getting real river data

BaadhMitra shows **simulated** river levels (labelled `sim`) until you connect an official source. Nothing here is a claim about what any agency offers: ask them, and use whatever they agree to.

## Who to ask
Central Water Commission (flood forecasting and monitoring), the Water Resources Department, Government of Bihar, and the Bihar State Disaster Management Authority. A district control room can often ask on your behalf, which carries more weight than a student email.

## What to ask for
Any one of these is enough to start:
1. A JSON or CSV feed (URL) of the latest gauge readings, refreshed at least hourly.
2. A scheduled export file you may fetch.
3. A written data-sharing permission, if the data is public but its reuse terms are unclear.

You need, per station: a station id, the water level, the **danger mark** (and warning mark if they have one), the station's latitude and longitude, and the **time of observation**. The last one matters: without it a frozen feed looks live.

## Email you can adapt
> Subject: Request for gauge data access for a flood-triage pilot (BaadhMitra)
>
> Respected Sir/Madam,
>
> I am [name], a software engineer from [place]. I have built an open-source prototype, BaadhMitra, that helps a district control room rank flood rescue requests and show river levels on one screen (https://github.com/antrikakashyap/baadhmitra). It currently uses *simulated* river levels, clearly labelled, because I do not have an official data source.
>
> I request guidance on how to receive official gauge readings (station id, level, danger mark, location, observation time) for [river / district], by an API, a periodic file, or any method you prefer, and the terms under which it may be used. The data would be used only to show levels and raise early-warning alerts to the control room; readings would be shown with their observation time and greyed out when old.
>
> I am happy to share a demo, the code and the security notes, and to run only as a shadow pilot alongside your existing process.
>
> Thank you,
> [name] · [phone] · [email]

Hindi version: `docs/outreach/EMAIL-HI.md`.

## Wire it in (when you have a feed)
1. Fetch a sample and save it, e.g. `sample.json`.
2. Write a map (see `docs/feed-map.example.json`): dotted paths for each value, a `scale` if units differ (e.g. `0.01` for cm to m), and a `stations` table for anything the feed lacks, copied from the agency's official station list.
3. Check it: `npm run feed:check -- sample.json map.json`. Fix paths until readings look right and nothing important is dropped.
4. Deploy (works in Windows CMD): `npx cdk deploy -c gaugeFeedUrl=https://your-feed-url -c gaugeFeedMapFile=map.json`. Invalid JSON in the map stops the deploy before anything changes.
5. If the agency issued a key, store it in the `baadhmitra/gauge-feed` secret (see Limits).
6. Watch the dashboard: real stations show without `sim`, and a `FeedDown` alarm tells you if the source goes quiet.

## Limits
- Feeds that need a single API-key header are supported: when a feed URL is set the stack creates the secret `baadhmitra/gauge-feed`. Put `{"header":"x-api-key","value":"<key>"}` in it (AWS console or `aws secretsmanager put-secret-value`). OAuth flows, signed requests and per-request tokens are not supported.
- Until a real feed is connected, do not describe the river levels in this project as real.
