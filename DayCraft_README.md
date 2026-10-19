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


## 2. Setup for re-running experiments

```bash
npm install                     
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


## 3. Reading a log

Each dataset log (`eval-*.json`) has `ranAt`, `n`, `seed`, `ranAi`, `retries`, `rowIndices`, a
`summary`, and one `perCase` entry per case with the row index, the `optimalScore`, the greedy
schedule and score, and (for AI runs) every raw option, whether it was valid and why not, its
score, and `bestValidScore`. Retry runs also keep every attempt. Places logs (`places-*.json`)
store the events used for each city, the options, the summary and the per-city results. The
greedy score is stored inside every AI log, so greedy can be checked without a separate file.


## 4. Data and credits

- Scheduling data: anakin87/events-scheduling (Hugging Face, Apache-2.0). Only the first 30 of
  its 500 training rows are used for AI results.
- Place data: Google Places API (New). Models: OpenAI gpt-4o-mini and gpt-4o.
- The weighted-interval-scheduling solver, greedy baseline, validator, retry loop, repair step,
  evaluation scripts and website are the author's own code, written with help from Claude
  (Anthropic), an AI coding assistant, and reviewed and run by the author.
