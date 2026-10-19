// node lib/verify-repair.js  (no API keys, no cost)
// Checks repairSchedule() on hand-made invalid schedules, then on 500
// randomly corrupted versions of real dataset answers: every repaired
// schedule must pass the strict validator, and repairing a schedule that is
// already valid must not change it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repairSchedule } from "./repair.js";
import { validateAiSchedule, computeOptimalSchedule } from "./optimalScheduler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
};

const events = [
  { name: "A", start: "09:00", end: "11:00" },
  { name: "B", start: "10:00", end: "10:45" },
  { name: "C", start: "11:00", end: "12:00" },
  { name: "D", start: "13:00", end: "14:00" },
];
const pri = ["B"];

let r = repairSchedule([{ name: "A", start: "09:00", end: "11:00" }, { name: "C", start: "11:00", end: "12:00" }], events, pri);
check("valid schedule is left unchanged", !r.changed && r.valid && r.schedule.length === 2);

r = repairSchedule([{ name: "A", start: "09:00", end: "11:00" }, { name: "B", start: "10:00", end: "10:45" }], events, pri);
// A weighs 120, B weighs 45*2 = 90 -> keep A
check("overlap: keeps the higher-scoring event", r.valid && r.schedule.length === 1 && r.schedule[0].name === "A", JSON.stringify(r));
check("overlap: reports the dropped event", r.actions.some((a) => a.type === "dropped-overlap" && a.name === "B"));

r = repairSchedule([{ name: "D", start: "13:30", end: "14:30" }], events, pri);
check("altered time is snapped to the real time", r.valid && r.schedule[0].start === "13:00" && r.actions[0].type === "snapped-time", JSON.stringify(r));

r = repairSchedule([{ name: "Zoo", start: "15:00", end: "16:00" }, { name: "D", start: "13:00", end: "14:00" }], events, pri);
check("invented event is dropped", r.valid && r.schedule.length === 1 && r.actions[0].type === "dropped-unknown");

r = repairSchedule([{ name: "D", start: "13:00", end: "14:00" }, { name: "d ", start: "13:00", end: "14:00" }], events, pri);
check("duplicate event is kept once", r.valid && r.schedule.length === 1 && r.actions.some((a) => a.type === "dropped-duplicate"));

r = repairSchedule([], events, pri);
check("empty schedule stays empty and valid", r.valid && r.schedule.length === 0 && r.score === 0);
r = repairSchedule(undefined, events, pri);
check("missing schedule does not crash", r.valid && r.schedule.length === 0);

// Stress test on real dataset rows: corrupt the optimal answer three ways.
const dataset = JSON.parse(fs.readFileSync(path.join(here, "scheduling-dataset.json"), "utf-8"));
let n = 0, bad = 0, changedValid = 0;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const row of dataset) {
  const evs = row.events.map(([name, start, end]) => ({ name, start, end }));
  const opt = computeOptimalSchedule(evs, row.priority_events).optimalSchedule.map((e) => evs.find((x) => x.name === e.name));
  // untouched optimal answer must pass through unchanged
  const same = repairSchedule(opt, evs, row.priority_events);
  if (same.changed || !same.valid || same.score !== row.optimal_score) changedValid++;
  // corrupted: add random extra events (overlaps), shift a time, add an invented event, duplicate one
  const corrupted = [...opt];
  for (let k = 0; k < 2; k++) corrupted.push(evs[Math.floor(rnd() * evs.length)]);
  if (corrupted.length) corrupted[0] = { ...corrupted[0], start: "00:05" };
  corrupted.push({ name: "Invented place", start: "12:00", end: "13:00" });
  const fixed = repairSchedule(corrupted, evs, row.priority_events);
  n++;
  if (!fixed.valid || !validateAiSchedule(fixed.schedule, evs, row.priority_events).valid) bad++;
}
check(`${n} corrupted dataset answers all repair to valid schedules`, bad === 0, `${bad} still invalid`);
check("untouched optimal answers pass through unchanged with the optimal score", changedValid === 0, `${changedValid} changed`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll repair checks passed.");
process.exit(failed ? 1 : 0);