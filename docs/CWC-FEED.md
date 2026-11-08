# River levels from the CWC daily bulletin

The Central Water Commission (CWC) publishes a flood bulletin PDF every day of the flood season. A small job in this repo reads it and keeps `data/cwc-latest.json` up to date, in the shape the gauge poller already understands. This is a **daily** source, not a live one.

## What you get, and what you do not

- Only the sites **at or above their warning level** are in the bulletin (its sections A, B and C). A river that is below warning is simply absent, so its level is unknown. Nothing is made up for it.
- The level is the observation printed in the bulletin (about 14:00 India time) on the bulletin date. The job reads that as India time.
- Only stations listed in `docs/cwc-bihar-stations.json` (18 Bihar stations) are written, because the bulletin has no coordinates. Stations in other states are counted in `data/cwc-latest.meta.json` under `skipped`.
- The positions in that table are the nearest town, not the gauge. Replace them with CWC's coordinates before relying on the map.
- Outside the flood season most days have no site above warning, so the file is an empty list. That is a normal answer, not an error.

## How it runs

`.github/workflows/cwc-feed.yml` runs twice a day (18:00 and 22:00 India time) and on demand:

1. `scripts/cwc_fetch.py` looks for today's bulletin, then up to three earlier days. CWC has no fixed link; it tries the file names seen in past bulletins (`cfcrcwcdfbDD.MM.YYYY.pdf`, then `_0`, `_1`, ... for re-uploads) and keeps the newest. If nothing is found it leaves the file as it was and the run shows a warning.
2. `scripts/cwc_bulletin.py` reads the tables. It checks the count of Bihar sites against the summary on page 1 and **stops with an error if they disagree** (the layout probably changed), instead of writing a quiet "all clear".
3. If the result changed, it commits `data/cwc-latest.json` and `data/cwc-latest.meta.json`.

The file names are patterns, not a promise. If CWC changes them the job will find nothing; look at the Actions tab now and then. GitHub also pauses scheduled jobs on a repository with no activity for 60 days.

## Switch it on

1. The repository must be **public** (the poller reads the raw file without signing in).
2. GitHub: `Settings → Actions → General → Workflow permissions → Read and write permissions → Save`.
3. `Actions → cwc-feed → Run workflow` once and check that `data/cwc-latest.meta.json` shows a bulletin date.
4. Deploy with the file as the feed. In Windows CMD, from the project folder:

```
npm run deploy -- -c gaugeFeedUrl=https://raw.githubusercontent.com/abhishek5228/BaadhMitra-Bihar/main/data/cwc-latest.json -c gaugeFeedPartial=true -c gaugeStaleHours=30
```

`gaugeFeedPartial=true` tells the poller that the list only has sites in flood: an empty list is valid, and a station that is not listed today is greyed out at once instead of keeping yesterday's reading. `gaugeStaleHours=30` lets a once-a-day reading stay fresh until the next bulletin (the default is 3 hours, which would grey everything).

## Check the parser yourself

```
pip install pdfplumber
python3 scripts/cwc_bulletin.py some-bulletin.pdf --out /tmp/out.json --meta /tmp/meta.json
cd python && python3 -m unittest discover -s tests -t .
```

The tests read two real bulletins kept in `test/fixtures/cwc/` (13/05/2024, no site in flood; 03/09/2024, 17 Bihar sites). The expected levels for 03/09/2024 were also read separately from the printed table and agree.
