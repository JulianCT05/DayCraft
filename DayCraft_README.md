# DayCraft: Reproducibility Package

This package holds the code and every saved experiment log behind the paper
"DayCraft: Valid Same-Day Itineraries from an LLM Scheduler". It lets a reader do three things:

1. **Check every reported number from the saved logs** (no API keys, no cost, about one second).
2. **Re-run the non-AI parts** (greedy baseline, exact solver, validator, repair) offline.
3. **Re-run the AI experiments** if they have their own OpenAI (and Google Places) keys.

Author and affiliation are left out so the package can be shared during double-anonymous review.

## 1. What is in this folder

```
README.md                 this file
package.json, package-lock.json
lib/                      the pipeline
  optimalScheduler.js       exact weighted-interval-scheduling solver + strict validator
  greedyScheduler.js        greedy baseline (priority events by earliest end, then normal events)
  baseline.js               non-AI place ranking (0.6 * rating/5 + 0.4 * interest match)
  events.js                 turns ranked places into timed events + priority flags
  scheduler.js              the LLM step: prompt, retry loop, model setting (DEFAULT_MODEL = gpt-4o-mini)
  repair.js                 deterministic repair of invalid LLM schedules
  examples.js, placeExamples.js, place-examples.json   few-shot examples (seed 42, 3 of 18)
  placesApi.js              Google Places API (New) call
  scheduling-dataset.json   the 500 training rows of anakin87/events-scheduling used here
  verify-examples.js        checks the hand-written examples against the solver
  verify-repair.js          checks repair on corrupted copies of real answers
app/                      the Next.js website (not needed for the experiments)
scripts/
  evaluate.js               dataset evaluation (greedy, and AI with --ai)
  evaluate-places.js        live Google Places evaluation (and --synthetic offline mode)
  check-logs.js             recomputes the headline numbers from the saved logs
  results/                  all 17 saved run logs (JSON)
```

Not included: `.env.local` (your keys), `node_modules`, and the abandoned fine-tuning folder
(it produced no reported result).

## 2. Check the paper's numbers from the saved logs (no keys needed)

Requires Node.js (the paper's runs used v24.14.0). No `npm install` is needed for this step.

```bash
node scripts/check-logs.js
```

It reads every log in `scripts/results/`, prints greedy / AI / AI+repair averages, the number of
cases with no valid option, and wins/ties/losses against greedy, and compares each headline log
with the value printed in the paper. Expected last line:

```
17 logs read, 0 difference(s) from the paper.
```

Wins/ties/losses for the two older gpt-4o-mini logs (Oct 13 and Oct 14) are counted from the
per-case data, because those logs do not store them in their summary.

## 3. Setup for re-running experiments

```bash
npm install                      # only needed for the website; the scripts use plain Node
```

Create a file named `.env.local` in this folder (never commit or share it):

```
OPENAI_API_KEY=your-openai-key
GOOGLE_PLACES_API_KEY=your-google-places-key
```

The scripts read this file themselves. The OpenAI key is needed only with `--ai`; the Google key
only for live Places runs. The key does not select the model: the model is the `--model` flag
(default `gpt-4o-mini`) and is recorded in the log file name and in a `model` field for
non-default models.

### Offline, free (no keys)

```bash
node lib/verify-examples.js                  # expect: All examples verified correct.
node lib/verify-repair.js                    # expect: All repair checks passed.
node scripts/evaluate.js --n 30              # greedy only, first 30 rows: 89.5% of optimal
node scripts/evaluate.js --n 500             # greedy only, all 500 rows: 92.4% with the current code
node scripts/evaluate-places.js --synthetic  # greedy only on built-in synthetic places: 84.3%
```

These were re-run while preparing this package and gave the values above. Each run writes a new
timestamped log into `scripts/results/`.

### With an OpenAI key (the AI experiments)

```bash
node scripts/evaluate.js --n 30 --ai                      # single call, no retry
node scripts/evaluate.js --n 30 --ai --retries 2          # up to 2 retries (repair scored on the same output)
node scripts/evaluate.js --n 30 --ai --retries 2 --model gpt-4o   # second model
```

`--n 30` takes the first 30 dataset rows in order (rows 0 to 29), the same cases in every run.
`--shuffle --seed N` picks a different, still reproducible, subset; it was not used for the
reported results.

### With OpenAI and Google keys (live Places)

```bash
node scripts/evaluate-places.js --cities "Raleigh NC,Greensboro NC,Charlotte NC" --ai --retries 2
node scripts/evaluate-places.js --cities "Raleigh NC,Greensboro NC,Charlotte NC" --ai --retries 2 --model gpt-4o
```

Settings used in every reported run: 8 hours, interests museum, park and cafe, medium budget,
10 candidate events, day starting at 9:00, temperature not set (API default), JSON response
format, stop retrying once 2 options are valid.

## 4. Which log backs which result

| Paper | Result | Log file in `scripts/results/` |
| --- | --- | --- |
| Table 1 | AI, single call (Oct 13): 72.7% | `eval-n30-seed1-with-ai-2026-10-13T18-00-05-502Z.json` |
| Table 1 | AI, up to 2 retries (Oct 14): 79.3% | `eval-n30-seed1-with-ai-retry2-2026-10-14T20-54-42-685Z.json` |
| Tables 1 and 4, Figure 1 | AI, retries (77.0%) and retries plus repair (80.2%) (Oct 18) | `eval-n30-seed1-with-ai-retry2-2026-10-18T18-01-43-075Z.json` |
| Table 4 | gpt-4o, dataset (68.7%) | `eval-n30-seed1-gpt-4o-with-ai-retry2-2026-10-18T22-48-25-708Z.json` |
| Table 1, Table 4 | Greedy, first 30 rows (89.5%) | `eval-n30-seed1-greedy-only-2026-10-13T17-09-38-273Z.json` (also `...17-56-14-871Z.json`) |
| Section 4.1 | Greedy, all 500 rows (92.4% with the current code; see the note in Section 6) | `eval-n500-seed1-greedy-only-2026-10-13T17-09-08-760Z.json` |
| Table 2 | Google Places, no retry (Oct 14) | `places-google-n3-with-ai-2026-10-14T18-56-30-302Z.json` |
| Table 2 | Google Places, retries, run 1 (Oct 14) | `places-google-n3-with-ai-retry2-2026-10-14T20-57-55-258Z.json` |
| Table 2 | Google Places, retries, run 2 (Oct 14) | `places-google-n3-with-ai-retry2-2026-10-14T21-05-21-018Z.json` |
| Tables 2 and 3 | Google Places, retries plus repair (Oct 18) | `places-google-n3-with-ai-retry2-2026-10-18T18-03-47-494Z.json` |
| Table 5 | Google Places, gpt-4o (Oct 18) | `places-google-n3-gpt-4o-with-ai-retry2-2026-10-18T22-49-45-401Z.json` |
| Section 4.4 (text) | Synthetic places, with retries (61.6% vs greedy 84.3%) | `places-synthetic-n3-with-ai-retry2-2026-10-14T20-56-21-557Z.json` |
| Section 4.4 (text) | Synthetic places, no retry (no valid option in 3 of 3) | `places-synthetic-n3-with-ai-2026-10-14T18-54-48-707Z.json` |

Two greedy-only 30-case logs and one 500-row log are kept for completeness but are **not** the
numbers in the paper (see the notes below).

## 5. Reading a log

Each dataset log (`eval-*.json`) has `ranAt`, `n`, `seed`, `ranAi`, `retries`, `rowIndices`, a
`summary`, and one `perCase` entry per case with the row index, the `optimalScore`, the greedy
schedule and score, and (for AI runs) every raw option, whether it was valid and why not, its
score, and `bestValidScore`. Retry runs also keep every attempt. Places logs (`places-*.json`)
store the events used for each city, the options, the summary and the per-city results. The
greedy score is stored inside every AI log, so greedy can be checked without a separate file.

## 6. Honest notes and limits

- **AI runs are not deterministic.** Temperature was not set, so a re-run will not reproduce a
  score exactly. The same gpt-4o-mini setup scored between 72.7% and 79.3% across runs. Compare
  with the saved logs, not with a single new run.
- **Live Places data was not saved.** A new Places run pulls fresh results, so its events (and
  scores) will differ. The events used in each reported run are stored inside its log.
- **Model version.** Logs record the model name you passed (for example `gpt-4o`). The three
  oldest gpt-4o-mini logs (Oct 13, 14, 18) have no `model` field; they used the code's only
  and default setting, `gpt-4o-mini`. OpenAI's dated model snapshot was not recorded.
- **Greedy-only logs that differ.**
  `eval-n30-seed1-greedy-only-2026-10-13T17-09-11-846Z.json` (91.9%) used a shuffled set of 30
  rows (rows 42, 62, 65, ...), not the first 30, so it is not the 89.5% comparison set.
  `eval-n500-seed1-greedy-only-2026-10-13T17-08-40-482Z.json` shows 92.04% on all 500 rows,
  but the run 28 seconds later (`...17-09-08-760Z.json`) shows 92.44%, and the current code
  reproduces 92.4%. The same rows should give the same number, so the first run came from an
  earlier version of the greedy code. The 30-row result (89.5%) is the same in every version.
  Use the 92.44% log for the all-500-rows figure.
- **Synthetic places.** The Oct 14 18:54 synthetic logs show greedy at 63.1%; the 20:56 retry log
  shows 84.3%, which is what `--synthetic` gives today. The synthetic place list changed in
  between, so synthetic runs are compared only within a log.
- **What "valid" means.** Valid means conflict-free and consistent with the input events. The
  application does not model travel time, real business hours or total spending, so a valid
  schedule is not a verified feasible day.
- **Few-shot examples.** Every run uses the same 3 of 18 examples from `lib/place-examples.json`,
  selected with seed 42 (`lib/placeExamples.js`). No dataset row used for evaluation appears in the prompt.
- **Cost and time.** Running the AI steps spends your own API credit; the 30-case runs make one
  to three model calls per case.

## 7. Data and credits

- Scheduling data: anakin87/events-scheduling (Hugging Face, Apache-2.0). Only the first 30 of
  its 500 training rows are used for AI results.
- Place data: Google Places API (New). Models: OpenAI gpt-4o-mini and gpt-4o.
- The weighted-interval-scheduling solver, greedy baseline, validator, retry loop, repair step,
  evaluation scripts and website are the author's own code, written with help from Claude
  (Anthropic), an AI coding assistant, and reviewed and run by the author.
