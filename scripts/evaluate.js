// scripts/evaluate.js
//
// Compares the non-AI greedy baseline and the AI scheduler on the SAME set
// of cases (previously they were compared on mismatched sample sizes — 500
// vs 30 — which is not a valid comparison; this was flagged in review and
// is fixed here: --n controls how many cases BOTH methods run on).
//
// Every per-case response and score is written to a timestamped JSON log
// file in scripts/results/, not just the printed averages, so a run is
// auditable afterward rather than only reproducible by chance.
//
// Validity is now checked with the strict validateAiSchedule() (exact
// name+start+end match to a real input event, no duplicate events, no
// overlaps) instead of the old isValidSchedule(), which did not check for
// altered times or repeated events.
//
// A case where the AI produced NO valid option scores 0 in the main
// average — it is reported, not silently excluded, which was also flagged
// in review (the old script dropped such cases from the "valid options
// only" denominator instead of counting them as a failure).
//
// Usage:
//   node scripts/evaluate.js --n 500          # greedy baseline only, full dataset, no AI/API cost
//   node scripts/evaluate.js --n 30 --ai       # greedy AND AI, same 30 cases, head-to-head
//   node scripts/evaluate.js --n 30 --ai --seed 7   # pick a different 30 cases (still both methods, same seed)

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeOptimalSchedule, validateAiSchedule } from "../lib/optimalScheduler.js";
import { greedySchedule } from "../lib/greedyScheduler.js";
import { generateScheduleOptions, generateScheduleOptionsWithRetry } from "../lib/scheduler.js";
import { repairAll } from "../lib/repair.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../lib/scheduling-dataset.json"), "utf-8")
);

function toEvents(row) {
  return row.events.map(([name, start, end]) => ({ name, start, end }));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getFlag = (name, def) => {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return def;
    const next = args[idx + 1];
    return next && !next.startsWith("--") ? next : true;
  };
  return {
    n: Number(getFlag("n", 500)),
    runAi: args.includes("--ai"),
    model: String(getFlag("model", "gpt-4o-mini")), 
    retries: Number(getFlag("retries", 0)), 
    shuffle: args.includes("--shuffle"),
    seed: Number(getFlag("seed", 1)), 
  };
}

// Default: the literal first N rows in dataset order (row 0, 1, 2, ...N-1).
// This matches how the original (pre-review) version of this script picked
// its AI sample, and how it was independently checked during review, so
// `--n 30` here reproduces that exact 30-case comparison. Pass --shuffle
// (with an optional --seed) only if you deliberately want a different,
// still-reproducible 30-case subset instead of the first 30.
function pickCaseIndices(total, n, shuffle, seed) {
  const idx = Array.from({ length: total }, (_, i) => i);
  if (!shuffle) return idx.slice(0, n);

  let t = seed;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).sort((a, b) => a - b); // sorted for readable logs
}

async function main() {
  const { n, runAi, shuffle, seed, retries, model } = parseArgs();
  const caseIndices = pickCaseIndices(dataset.length, Math.min(n, dataset.length), shuffle, seed);

  const perCaseResults = [];
  let greedyRatioSum = 0;
  let aiRatioSum = 0;
  let casesWithNoValidAiOption = 0;
  // AI + automatic repair (lib/repair.js), scored on the same cases
  let repairRatioSum = 0;
  let casesNoValidAfterRepair = 0;
  let casesNeedingRepair = 0;
  const vs = { ai: { win: 0, tie: 0, loss: 0 }, repair: { win: 0, tie: 0, loss: 0 } };
  const tally = (bucket, score, greedyScore) => {
    if (score > greedyScore) bucket.win++;
    else if (score === greedyScore) bucket.tie++;
    else bucket.loss++;
  };

  for (const i of caseIndices) {
    const row = dataset[i];
    const events = toEvents(row);
    const optimalScore = row.optimal_score;

    const greedy = greedySchedule(events, row.priority_events);
    const greedyResult = validateAiSchedule(
      greedy.map((e) => ({
        name: e.name,
        start: typeof e.start === "number" ? minutesToClock(e.start) : e.start,
        end: typeof e.end === "number" ? minutesToClock(e.end) : e.end,
      })),
      events,
      row.priority_events
    );
    const greedyScore = greedyResult.valid ? greedyResult.score : 0;
    greedyRatioSum += greedyScore / optimalScore;

    const caseLog = {
      rowIndex: i,
      prompt: row.prompt,
      optimalScore,
      greedy: {
        schedule: greedy,
        valid: greedyResult.valid,
        reason: greedyResult.reason,
        score: greedyScore,
        ratio: Number((greedyScore / optimalScore).toFixed(4)),
      },
    };

    if (runAi) {
      try {
        const aiInput = {
          city: "N/A",
          budget: "N/A",
          hours: 24,
          events: events.map((e) => ({ ...e, priority: row.priority_events.includes(e.name) })),
          apiKey: process.env.OPENAI_API_KEY,
          model,
        };
        let options;
        let attempts = null;
        if (retries > 0) {
          const r = await generateScheduleOptionsWithRetry({ ...aiInput, maxRetries: retries });
          options = r.options;
          attempts = r.attempts;
        } else {
          options = await generateScheduleOptions(aiInput);
        }

        const scoredOptions = options.map((o) => {
          const result = validateAiSchedule(o.schedule, events, row.priority_events);
          return { label: o.label, schedule: o.schedule, valid: result.valid, reason: result.reason, score: result.score };
        });

        const validScores = scoredOptions.filter((o) => o.valid).map((o) => o.score);
        const bestValidScore = validScores.length > 0 ? Math.max(...validScores) : 0;
        if (validScores.length === 0) casesWithNoValidAiOption++;

        aiRatioSum += bestValidScore / optimalScore;

        // Repair every option the model produced (all attempts, if retries
        // were on). Options that were already valid pass through unchanged,
        // so the best repaired score can only be >= the strict score.
        const rawForRepair = attempts ? attempts.flatMap((a) => a.rawOptions) : options;
        const repaired = repairAll(rawForRepair, events, row.priority_events);
        const repairedValidScores = repaired.filter((o) => o.valid).map((o) => o.score);
        const bestRepairScore = repairedValidScores.length > 0 ? Math.max(...repairedValidScores) : 0;
        if (repairedValidScores.length === 0) casesNoValidAfterRepair++;
        if (validScores.length === 0 && bestRepairScore > 0) casesNeedingRepair++;
        repairRatioSum += bestRepairScore / optimalScore;
        tally(vs.ai, bestValidScore, greedyScore);
        tally(vs.repair, bestRepairScore, greedyScore);

        caseLog.ai = {
          retries,
          attemptsUsed: attempts ? attempts.length : 1,
          attempts,
          rawOptions: options,
          scoredOptions,
          bestValidScore,
          ratio: Number((bestValidScore / optimalScore).toFixed(4)),
          hadNoValidOption: validScores.length === 0,
          repair: {
            options: repaired,
            bestScore: bestRepairScore,
            ratio: Number((bestRepairScore / optimalScore).toFixed(4)),
            hadNoValidOption: repairedValidScores.length === 0,
          },
        };
      } catch (err) {
        caseLog.ai = { error: err.message, bestValidScore: 0, ratio: 0, hadNoValidOption: true };
        casesWithNoValidAiOption++;
        casesNoValidAfterRepair++;
        tally(vs.ai, 0, greedyScore);
        tally(vs.repair, 0, greedyScore);
      }
    }

    perCaseResults.push(caseLog);
    process.stdout.write(`.`); 
  }
  console.log(); 

  const greedyAvg = (greedyRatioSum / caseIndices.length) * 100;
  console.log(`\nCases evaluated: ${caseIndices.length} (seed=${seed})${runAi ? `, model: ${model}` : ""}`);
  console.log(`Greedy baseline: ${greedyAvg.toFixed(1)}% of optimal score, on average`);

  if (runAi) {
    const aiAvg = (aiRatioSum / caseIndices.length) * 100;
    console.log(
      `AI scheduler (best VALID option per case; cases with no valid option scored 0): ${aiAvg.toFixed(1)}% of optimal score, on average`
    );
    console.log(
      `Cases with NO valid AI option at all: ${casesWithNoValidAiOption}/${caseIndices.length} (${((casesWithNoValidAiOption / caseIndices.length) * 100).toFixed(1)}%)`
    );
    const n = caseIndices.length;
    console.log(`AI + automatic repair (invalid options fixed by lib/repair.js): ${((repairRatioSum / n) * 100).toFixed(1)}% of optimal score, on average`);
    console.log(`Cases with no valid option even after repair: ${casesNoValidAfterRepair}/${n}; cases rescued by repair: ${casesNeedingRepair}`);
    console.log(`Versus greedy (win/tie/loss, by score): AI ${vs.ai.win}/${vs.ai.tie}/${vs.ai.loss}  |  AI+repair ${vs.repair.win}/${vs.repair.tie}/${vs.repair.loss}`);
    console.log(`Both methods evaluated on the identical ${caseIndices.length} cases (row indices logged below).`);
  }

  
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const modelTag = runAi && model !== "gpt-4o-mini" ? `-${model}` : "";
  const outFile = path.join(resultsDir, `eval-n${caseIndices.length}-seed${seed}${modelTag}-${runAi ? (retries > 0 ? `with-ai-retry${retries}` : "with-ai") : "greedy-only"}-${timestamp}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        n: caseIndices.length,
        seed,
        ranAi: runAi,
        model: runAi ? model : null,
        retries,
        rowIndices: caseIndices,
        summary: {
          greedyAvgPercent: Number(greedyAvg.toFixed(2)),
          aiAvgPercent: runAi ? Number(((aiRatioSum / caseIndices.length) * 100).toFixed(2)) : null,
          casesWithNoValidAiOption: runAi ? casesWithNoValidAiOption : null,
          aiRepairAvgPercent: runAi ? Number(((repairRatioSum / caseIndices.length) * 100).toFixed(2)) : null,
          casesNoValidAfterRepair: runAi ? casesNoValidAfterRepair : null,
          casesRescuedByRepair: runAi ? casesNeedingRepair : null,
          vsGreedy: runAi ? vs : null,
        },
        perCase: perCaseResults,
      },
      null,
      2
    )
  );
  console.log(`\nFull per-case responses and scores saved to: ${path.relative(process.cwd(), outFile)}`);
}


function minutesToClock(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

main();