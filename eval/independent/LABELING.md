# Independent accuracy test: how to run it

The built-in benchmark (`eval/labeled.json`) was written by the author next to the extractor, so it cannot show real accuracy. This protocol produces a number you can defend.

## Two groups, kept apart
- **Writers (3 to 5 people)** write realistic flood messages. They must **not** have seen the extractor's word list. Ask each for 30 to 50 messages in the way people in their area really write: Hindi, Hinglish, Bhojpuri, Maithili, English, typos, voice-to-text mistakes, short and long. Better still, use real messages with the senders' permission and personal details removed. Put them in `messages.csv` with a column `t` (and optional `id`).
- **Labelers (2 people, not the writers)** open `label.html` (double-click, works offline), load `messages.csv`, and fill the fields for every message. Both label **all** messages separately; their disagreement is part of the result.

Target: **at least 100 messages, 150 to 200 is better.** Include a fair share with no place, no number of people, or no depth stated: an honest test has missing information.

## Labeling rules (give these to the labelers)
1. Use only what the message **says**. If it is not written, leave it empty. Do not guess.
2. **Place**: the town or village named. Hindi or English spelling is fine. Empty if none.
3. **People**: the number at risk if stated ("12 log", "teen bachche"). Empty if not stated.
4. **Depth in cm**: ankle 15, knee 50, waist ("kamar") 100, chest 130, roof or "chhat par" 300. Empty if not stated.
5. **Severity 1-5**: 1 a puddle or nuisance, 2 water outside the house, 3 water inside, 4 trapped or running out of supplies, 5 life at risk now (drowning, medical emergency, children or elderly stuck on a roof).
6. **Needs**: tick only what they ask for: boat, food, water, medical, shelter.
7. **Vulnerable**: tick if children, elderly, pregnant or disabled people are mentioned.
8. Do not look at what the system predicts. Do not discuss answers with the other labeler until both have exported.

## Score it
```bash
npm run eval:ind -- labels-A.csv labels-B.csv     # scores against A, reports A-vs-B agreement
LLM=1 MODEL=<bedrock id> npm run eval:ind -- labels-A.csv   # also scores the Bedrock model
```
The report goes to `eval/independent/REPORT.md` with 95% confidence intervals. Quote the report, include how many messages, who wrote and who labelled, and say it is a small sample. Never replace these numbers with the author benchmark.

## Reading the result
- If labelers agree with each other 85% of the time, an extractor scoring 80% is doing about as well as people can.
- "Place not in gazetteer" shows how many true places the built-in town list cannot place. That is a data gap (`npm run villages`), not a model failure.
- Fix the biggest misses, then collect a **new** set. Reusing a set you tuned on makes it a training set again.
