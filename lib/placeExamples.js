// lib/placeExamples.js
//
// The 18 original place-based example schedules (8 hand-written + 10
// generated earlier in this project), converted to the current
// name/start/end schema. Unlike lib/examples.js (which teaches the
// non-overlap/optimization logic via the abstract dataset format), these
// teach realistic place naming and good label/rationale style for
// multi-option output.
//
// IMPORTANT: this used to pick 3 of the 18 examples with Math.random() on
// every call, which meant the few-shot prompt itself silently changed
// between runs — a real bug, and the most likely explanation for why two
// earlier evaluation runs produced different AI scores (80.6% vs 78.7%)
// despite "the same" evaluation: they were not actually the same prompt. A
// `seed` argument now makes selection deterministic (same seed = same
// examples, every time), so a given evaluation run is reproducible and can
// be cited as an exact, repeatable number.

import data from "./place-examples.json" with { type: "json" };

// Small deterministic PRNG (mulberry32) so a given seed always produces the
// same shuffle, in any JS environment, without relying on Math.random().
function seededRandom(seed) {
  let t = seed;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} count  how many style examples to include
 * @param {number} seed   fixed seed = reproducible selection; pass a
 *   different seed (e.g. the dataset row index) if you deliberately want
 *   varied-but-still-reproducible prompts across a batch of cases.
 */
export function formatPlaceExamplesForPrompt(count = 3, seed = 42) {
  const rand = seededRandom(seed);
  const sample = [...data].sort(() => rand() - 0.5).slice(0, count);
  return sample
    .map((ex, i) => {
      const opt = ex.options[0]; // one representative option per entry is enough
      const stopsText = opt.schedule.map((s) => `${s.start}-${s.end} ${s.name}`).join("; ");
      return `Style example ${i + 1} (${ex.city}, ${ex.budget} budget, interests: ${ex.interests.join(", ")}):\nLabel: "${opt.label}"\nRationale: "${opt.rationale}"\nSchedule: ${stopsText}`;
    })
    .join("\n\n");
}
