// scripts/evaluate-places.js
//
// Validity check on the REAL web-app pipeline: place candidates -> events
// (lib/events.js) -> greedy / optimal / AI scheduler.
//
// Unlike scripts/evaluate.js (which uses the dataset's synthetic events),
// the events here come from Google Places (or from a built-in synthetic
// place list, see --synthetic). There is no dataset-provided ground truth
// for these, so the "optimal" score is computed live with the DP solver
// (lib/optimalScheduler.js), which is exact for any event list. Results are
// therefore comparable in the same way as evaluate.js: % of optimal, plus
// validity and the no-valid-option rate.
//
// Usage:
//   node scripts/evaluate-places.js --synthetic                 # no API keys, no cost (greedy only)
//   node scripts/evaluate-places.js --synthetic --ai            # synthetic places + AI (needs OPENAI_API_KEY)
//   node scripts/evaluate-places.js --cities "Raleigh NC,Paris,Tokyo" --interests museum,park,cafe --budget medium --hours 8 --ai
//                                                              # real Places data (needs GOOGLE_PLACES_API_KEY)
//
// Every run writes scripts/results/places-*.json with the place snapshot,
// events, prompts' inputs, raw AI options and per-option validity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeOptimalSchedule, validateAiSchedule } from "../lib/optimalScheduler.js";
import { greedySchedule } from "../lib/greedyScheduler.js";
import { generateScheduleOptions, generateScheduleOptionsWithRetry } from "../lib/scheduler.js";
import { repairAll } from "../lib/repair.js";
import { fetchPlaces } from "../lib/placesApi.js";
import { rankPlaces } from "../lib/baseline.js";
import { buildEvents } from "../lib/events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = t.slice(eq + 1).trim();
  }
}
loadEnvLocal();

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return def;
    const next = args[i + 1];
    return next && !next.startsWith("--") ? next : true;
  };
  const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);
  return {
    synthetic: args.includes("--synthetic"),
    runAi: args.includes("--ai"),
    retries: Number(get("retries", 0)), 
    model: String(get("model", "gpt-4o-mini")),
    cities: list(get("cities", "Raleigh NC,Paris,Tokyo")),
    interests: list(get("interests", "museum,park,cafe")),
    budget: String(get("budget", "medium")),
    hours: Number(get("hours", 8)),
    candidates: Number(get("candidates", 10)),
  };
}


const SYNTHETIC_TYPES = [
  ["museum", "tourist_attraction"],
  ["park"],
  ["cafe", "coffee_shop"],
  ["restaurant"],
  ["art_gallery"],
  ["historical_landmark", "tourist_attraction"],
  ["shopping_mall"],
  ["museum"],
  ["park", "tourist_attraction"],
  ["cafe"],
  ["restaurant"],
  ["art_gallery", "museum"],
];
function syntheticPlaces(city) {
  // Rotate the type list and rating pattern by a hash of the city name so
  // different "cities" give different (but repeatable) event sets.
  const h = [...city].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rot = h % SYNTHETIC_TYPES.length;
  const step = 3 + (h % 5);
  return SYNTHETIC_TYPES.map((_, i) => SYNTHETIC_TYPES[(i + rot) % SYNTHETIC_TYPES.length]).map((types, i) => ({
    id: `synthetic-${city}-${i}`,
    name: `${city} ${types[0].replace(/_/g, " ")} ${i + 1}`,
    address: "",
    rating: Number((3.6 + ((i * step) % 14) / 10).toFixed(1)),
    ratingCount: 100 + i * 37,
    priceLevel: null,
    priceRange: null,
    openNow: null,
    types,
    lat: null,
    lng: null,
  }));
}

async function main() {
  const opts = parseArgs();
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!opts.synthetic && !googleKey) {
    console.error("No GOOGLE_PLACES_API_KEY found. Add it to .env.local, or pass --synthetic to use built-in synthetic places.");
    process.exit(1);
  }
  if (opts.runAi && !openaiKey) {
    console.error("--ai needs OPENAI_API_KEY in .env.local.");
    process.exit(1);
  }

  const perCity = [];
  let greedySum = 0;
  let aiSum = 0;
  let noValid = 0;
  let repairSum = 0;
  let noValidAfterRepair = 0;
  let rescued = 0;
  const vs = { ai: { win: 0, tie: 0, loss: 0 }, repair: { win: 0, tie: 0, loss: 0 } };
  const tally = (bucket, score, g) => {
    if (score > g) bucket.win++;
    else if (score === g) bucket.tie++;
    else bucket.loss++;
  };

  for (const city of opts.cities) {
    const places = opts.synthetic
      ? syntheticPlaces(city)
      : await fetchPlaces({ city, interests: opts.interests, budget: opts.budget, apiKey: googleKey });
    const ranked = rankPlaces(places, opts.interests);
    const events = buildEvents(ranked, opts.interests, opts.hours, 540, opts.candidates);
    const plain = events.map((e) => ({ name: e.name, start: e.start, end: e.end }));
    const priorityNames = events.filter((e) => e.priority).map((e) => e.name);

    if (events.length === 0) {
      console.warn(`${city}: no events produced, skipping.`);
      continue;
    }

    // Exact ground truth for this event set.
    const { optimalScore } = computeOptimalSchedule(plain, priorityNames);

    // Greedy, validated the same strict way as the AI output.
    const greedy = greedySchedule(plain, priorityNames);
    const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const greedyResult = validateAiSchedule(
      greedy.map((e) => ({
        name: e.name,
        start: typeof e.start === "number" ? clock(e.start) : e.start,
        end: typeof e.end === "number" ? clock(e.end) : e.end,
      })),
      plain,
      priorityNames
    );
    const greedyScore = greedyResult.valid ? greedyResult.score : 0;
    const greedyRatio = optimalScore ? greedyScore / optimalScore : 0;
    greedySum += greedyRatio;

    const log = {
      city,
      placeCount: places.length,
      places: places.map((p) => ({ id: p.id, name: p.name, types: p.types, rating: p.rating })),
      events: plain.map((e) => ({ ...e, priority: priorityNames.includes(e.name) })),
      optimalScore,
      greedy: { valid: greedyResult.valid, reason: greedyResult.reason, score: greedyScore, ratio: Number(greedyRatio.toFixed(4)) },
    };

    let line = `${city}: ${events.length} events, optimal=${optimalScore}, greedy=${(greedyRatio * 100).toFixed(1)}%`;

    if (opts.runAi) {
      try {
        const aiInput = {
          city,
          budget: opts.budget,
          hours: opts.hours,
          events: events.map((e) => ({ ...e })),
          apiKey: openaiKey,
          model: opts.model,
        };
        let options;
        let attempts = null;
        if (opts.retries > 0) {
          const r = await generateScheduleOptionsWithRetry({ ...aiInput, maxRetries: opts.retries });
          options = r.options;
          attempts = r.attempts;
        } else {
          options = await generateScheduleOptions(aiInput);
        }
        const scored = options.map((o) => {
          const r = validateAiSchedule(o.schedule, plain, priorityNames);
          return { label: o.label, schedule: o.schedule, valid: r.valid, reason: r.reason, score: r.score };
        });
        const validScores = scored.filter((o) => o.valid).map((o) => o.score);
        const best = validScores.length ? Math.max(...validScores) : 0;
        if (!validScores.length) noValid++;
        const ratio = optimalScore ? best / optimalScore : 0;
        aiSum += ratio;

        // Automatic repair on everything the model produced (all attempts if retries were on).
        const rawForRepair = attempts ? attempts.flatMap((a) => a.rawOptions) : options;
        const repaired = repairAll(rawForRepair, plain, priorityNames);
        const repairedScores = repaired.filter((o) => o.valid).map((o) => o.score);
        const bestRepair = repairedScores.length ? Math.max(...repairedScores) : 0;
        const repairRatio = optimalScore ? bestRepair / optimalScore : 0;
        repairSum += repairRatio;
        if (!repairedScores.length) noValidAfterRepair++;
        if (!validScores.length && bestRepair > 0) rescued++;
        tally(vs.ai, best, greedyScore);
        tally(vs.repair, bestRepair, greedyScore);
        log.ai = {
          retries: opts.retries,
          attemptsUsed: attempts ? attempts.length : 1,
          attempts,
          rawOptions: options,
          scoredOptions: scored,
          validOptionCount: validScores.length,
          bestValidScore: best,
          ratio: Number(ratio.toFixed(4)),
          hadNoValidOption: !validScores.length,
          repair: {
            options: repaired,
            bestScore: bestRepair,
            ratio: Number(repairRatio.toFixed(4)),
            hadNoValidOption: !repairedScores.length,
          },
        };
        line += `, AI=${(ratio * 100).toFixed(1)}% (${validScores.length}/${scored.length} options valid), AI+repair=${(repairRatio * 100).toFixed(1)}%`;
      } catch (err) {
        noValid++;
        noValidAfterRepair++;
        tally(vs.ai, 0, greedyScore);
        tally(vs.repair, 0, greedyScore);
        log.ai = { error: err.message, bestValidScore: 0, ratio: 0, hadNoValidOption: true };
        line += `, AI error: ${err.message}`;
      }
    }
    console.log(line);
    perCity.push(log);
  }

  const n = perCity.length;
  if (!n) {
    console.error("No cities evaluated.");
    process.exit(1);
  }
  console.log(`\nModel: ${opts.runAi ? opts.model : "(no AI)"}`);
  console.log(`Source: ${opts.synthetic ? "synthetic places" : "Google Places API"} | cities: ${n} | hours: ${opts.hours} | interests: ${opts.interests.join(", ")}`);
  console.log(`Greedy: ${((greedySum / n) * 100).toFixed(1)}% of optimal, on average`);
  if (opts.runAi) {
    console.log(`AI (best valid option; none valid scored 0): ${((aiSum / n) * 100).toFixed(1)}% of optimal, on average`);
    console.log(`Cities with NO valid AI option: ${noValid}/${n}`);
    console.log(`AI + automatic repair: ${((repairSum / n) * 100).toFixed(1)}% of optimal, on average (no valid option even after repair: ${noValidAfterRepair}/${n}; rescued by repair: ${rescued})`);
    console.log(`Versus greedy (win/tie/loss, by score): AI ${vs.ai.win}/${vs.ai.tie}/${vs.ai.loss}  |  AI+repair ${vs.repair.win}/${vs.repair.tie}/${vs.repair.loss}`);
  }

  const dir = path.join(__dirname, "results");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const modelTag = opts.runAi && opts.model !== "gpt-4o-mini" ? `${opts.model}-` : "";
  const out = path.join(dir, `places-${opts.synthetic ? "synthetic" : "google"}-n${n}-${modelTag}${opts.runAi ? (opts.retries > 0 ? `with-ai-retry${opts.retries}` : "with-ai") : "greedy-only"}-${stamp}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        source: opts.synthetic ? "synthetic" : "google-places",
        options: opts,
        summary: {
          greedyAvgPercent: Number(((greedySum / n) * 100).toFixed(2)),
          aiAvgPercent: opts.runAi ? Number(((aiSum / n) * 100).toFixed(2)) : null,
          citiesWithNoValidAiOption: opts.runAi ? noValid : null,
          aiRepairAvgPercent: opts.runAi ? Number(((repairSum / n) * 100).toFixed(2)) : null,
          citiesNoValidAfterRepair: opts.runAi ? noValidAfterRepair : null,
          citiesRescuedByRepair: opts.runAi ? rescued : null,
          vsGreedy: opts.runAi ? vs : null,
        },
        perCity,
      },
      null,
      2
    )
  );
  console.log(`\nSaved: ${path.relative(process.cwd(), out)}`);
}

main();