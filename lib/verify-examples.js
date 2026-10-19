// lib/verify-examples.js
//
// Recomputes each FEW_SHOT_EXAMPLES entry's optimal schedule using the real
// solver (optimalScheduler.js) and fails loudly if a hand-written example
// doesn't match exactly. Run this after editing examples.js, and ideally
// wire it into a pretest/CI step so a bad example (like the overlapping
// "optimal" schedule found in Checkpoint 2 review) can never ship silently
// again.
//
// Usage: node lib/verify-examples.js

import { FEW_SHOT_EXAMPLES } from "./examples.js";
import { computeOptimalSchedule, isValidSchedule } from "./optimalScheduler.js";

function parsePromptEvents(prompt) {
  const lines = prompt.split("\n");
  const events = [];
  let inEvents = false;
  let priorities = [];
  let inPriorities = false;
  for (const line of lines) {
    if (line.startsWith("Events:")) { inEvents = true; continue; }
    if (line.startsWith("Priorities:")) { inEvents = false; inPriorities = true; continue; }
    if (inEvents && line.startsWith("-")) {
      const m = line.match(/^- (.+) \((\d{2}:\d{2}) - (\d{2}:\d{2})\)$/);
      if (m) events.push({ name: m[1], start: m[2], end: m[3] });
    }
    if (inPriorities && line.startsWith("-")) {
      priorities.push(line.slice(2).trim());
    }
  }
  return { events, priorities };
}

function minutesToClock(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function main() {
  let failures = 0;

  FEW_SHOT_EXAMPLES.forEach((ex, i) => {
    const { events, priorities } = parsePromptEvents(ex.prompt);
    const { optimalSchedule, optimalScore } = computeOptimalSchedule(events, priorities);
    const computed = optimalSchedule
      .map((e) => ({ name: e.name, start: minutesToClock(e.start), end: minutesToClock(e.end) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const listed = [...ex.schedule].sort((a, b) => a.name.localeCompare(b.name));

    const matches = JSON.stringify(computed) === JSON.stringify(listed);
    const listedIsValid = isValidSchedule(ex.schedule);

    console.log(`\nExample ${i + 1}:`);
    console.log(`  Listed schedule valid (non-overlapping)?  ${listedIsValid}`);
    console.log(`  Listed schedule matches true solver optimum?  ${matches}`);
    if (!matches || !listedIsValid) {
      failures++;
      console.log(`  LISTED: ${JSON.stringify(listed)}`);
      console.log(`  ACTUAL OPTIMAL (score ${optimalScore}): ${JSON.stringify(computed)}`);
    }
  });

  console.log(`\n${failures === 0 ? "All examples verified correct." : `${failures} example(s) FAILED verification.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
