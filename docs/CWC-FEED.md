# River levels from the CWC daily bulletin

The Central Water Commission (CWC) publishes a flood bulletin PDF every day of the flood season. A small job in this repo reads the PDFs you upload and keeps `data/cwc-latest.json` up to date, in the shape the gauge poller already understands. This is a **daily** source, not a live one.

## What you get, and what you do not

- Only the sites **at or above their warning level** are in the bulletin (its sections A, B and C). A river that is below warning is simply absent, so its level is unknown. Nothing is made up for it.
- The level is the observation printed in the bulletin (about 14:00 India time) on the bulletin date. The job reads that as India time.
- Only stations listed in `docs/cwc-bihar-stations.json` (18 Bihar stations) are written, because the bulletin has no coordinates. Stations in other states are counted in `data/cwc-latest.meta.json` under `skipped`.
- The positions in that table are the nearest town, not the gauge. Replace them with CWC's coordinates before relying on the map.
- Outside the flood season most days have no site above warning, so the file is an empty list. That is a normal answer, not an error.

## How it runs

cwc.gov.in answers automated downloads with **HTTP 401** (tried from a GitHub runner), so the PDF is saved by a person and handed to the job:

1. In your browser, open the day's bulletin on cwc.gov.in and save the PDF.
2. In the GitHub repository open the `inbox` folder: **Add file → Upload files**, drop the PDF, **Commit changes**.
3. `.github/workflows/cwc-feed.yml` starts by itself. `scripts/cwc_bulletin.py` reads every PDF in `inbox/`, takes the **newest bulletin by date**, and writes `data/cwc-latest.json` and `data/cwc-latest.meta.json`. A file that is not a bulletin is named and skipped.
4. It checks the count of Bihar sites against the summary on page 1 and **stops with an error if they disagree** (the layout probably changed), instead of writing a quiet "all clear".
5. If the result changed, it commits the two data files. The poller picks it up at its next run (every 15 minutes by default).

One upload a day during the flood season is the whole routine. Old PDFs can stay; the newest bulletin by date always wins. A failed run shows red in the Actions tab with the reason.

`scripts/cwc_fetch.py` can look for the bulletin by file-name pattern (`cfcrcwcdfbDD.MM.YYYY.pdf`, then `_0`, `_1`, ...) and refuses anything that is not a PDF. It does not work from GitHub because of the 401; it may work from your own computer: `python scripts\cwc_fetch.py --out inbox\today.pdf`. If CWC lets automated readers in, or gives a data feed, the schedule can come back; the data request in [`DATA-REQUEST.md`](DATA-REQUEST.md) is the proper route.

## Switch it on

1. The repository must be **public** (the poller reads the raw file without signing in).
2. GitHub: `Settings → Actions → General → Workflow permissions → Read and write permissions → Save`.
3. Upload one bulletin to `inbox/` and check that `data/cwc-latest.meta.json` shows its date.
4. Deploy with the file as the feed. In Windows CMD, from the project folder:

```
npm run deploy -- -c gaugeFeedUrl=https://raw.githubusercontent.com/abhishek5228/BaadhMitra-Bihar/main/data/cwc-latest.json -c gaugeFeedPartial=true -c gaugeStaleHours=30
```

`gaugeFeedPartial=true` tells the poller that the list only has sites in flood: an empty list is valid, and a station that is not listed today is greyed out at once instead of keeping yesterday's reading. `gaugeStaleHours=30` lets a once-a-day reading stay fresh until the next bulletin (the default is 3 hours, which would grey everything). If nobody uploads for more than 30 hours, every reading goes grey: that is the intended signal that the data is old.

## Check the parser yourself

```
pip install pdfplumber
python scripts\cwc_bulletin.py inbox\*.pdf --out data\cwc-latest.json --meta data\cwc-latest.meta.json
cd python && python3 -m unittest discover -s tests -t .
```

The tests read two real bulletins kept in `test/fixtures/cwc/` (13/05/2024, no site in flood; 03/09/2024, 17 Bihar sites). The expected levels for 03/09/2024 were also read separately from the printed table and agree.
