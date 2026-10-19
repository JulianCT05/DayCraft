// lib/repair.js
//
// Automatic repair of AI-produced schedules. No second LLM call: this is a
// deterministic post-processing step that turns an invalid schedule into a
// valid one while keeping as much of the AI's own choice as possible.
//
// Steps, in order:
//   1. SNAP    each item to a real input event. An exact name+start+end match
//              is kept. Otherwise, if the name matches a real event (ignoring
//              case/extra spaces), the item takes that event's real times
//              (this fixes altered/invented times). Items that match no real
//              event are dropped (invented events).
//   2. DEDUPE  an event used twice is kept once.
//   3. OVERLAPS among what is left, keep the non-overlapping subset with the
//              highest weighted score (weighted interval scheduling over the
//              AI's own picks only). The AI's selection is only ever
//              shrunk, never extended with events it did not choose.
//
// The result always passes validateAiSchedule(). The actions list says what
// was changed, so the website and the evaluation logs can show it.

import { computeOptimalSchedule, validateAiSchedule } from "./optimalScheduler.js";

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function findRealEvent(item, allEvents) {
  const exact = allEvents.find(
    (e) => e.name === item?.name && e.start === item?.start && e.end === item?.end
  );
  if (exact) return { event: exact, snapped: false };

  const sameName = allEvents.filter((e) => norm(e.name) === norm(item?.name));
  if (sameName.length === 0) return null;

  // Several events can share a name; take the one whose start is closest.
  const itemStart = /^\d{1,2}:\d{2}$/.test(item?.start ?? "") ? toMinutes(item.start) : null;
  const event =
    itemStart === null
      ? sameName[0]
      : sameName.reduce((best, e) =>
          Math.abs(toMinutes(e.start) - itemStart) < Math.abs(toMinutes(best.start) - itemStart) ? e : best
        );
  return { event, snapped: true };
}

/**
 * @param {Array<{name,start,end}>} schedule     AI output (may be invalid)
 * @param {Array<{name,start,end}>} allEvents    the real input events
 * @param {string[]} priorityNames
 * @returns {{ schedule: object[], actions: object[], valid: boolean, score: number, changed: boolean }}
 */
export function repairSchedule(schedule, allEvents, priorityNames) {
  const actions = [];
  const items = Array.isArray(schedule) ? schedule : [];

  // 1 + 2: snap to real events, drop unknowns and duplicates
  const kept = [];
  const usedNames = new Set();
  for (const item of items) {
    const found = findRealEvent(item, allEvents);
    if (!found) {
      actions.push({ type: "dropped-unknown", name: item?.name ?? null });
      continue;
    }
    const { event, snapped } = found;
    if (usedNames.has(event.name)) {
      actions.push({ type: "dropped-duplicate", name: event.name });
      continue;
    }
    usedNames.add(event.name);
    if (snapped) {
      actions.push({
        type: "snapped-time",
        name: event.name,
        from: `${item.start}-${item.end}`,
        to: `${event.start}-${event.end}`,
      });
    }
    kept.push({ name: event.name, start: event.start, end: event.end });
  }

  // 3: resolve overlaps, keeping the highest-scoring non-overlapping subset
  let final = kept;
  if (kept.length > 1) {
    const { optimalSchedule } = computeOptimalSchedule(kept, priorityNames);
    const keepNames = new Set(optimalSchedule.map((e) => e.name));
    final = kept.filter((e) => keepNames.has(e.name));
    for (const e of kept) {
      if (!keepNames.has(e.name)) {
        actions.push({ type: "dropped-overlap", name: e.name, at: `${e.start}-${e.end}` });
      }
    }
  }

  final = [...final].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const check = validateAiSchedule(final, allEvents, priorityNames);
  return {
    schedule: final,
    actions,
    valid: check.valid,
    score: check.valid ? check.score : 0,
    changed: actions.length > 0,
  };
}

/**
 * @param {Array<{label,rationale?,schedule}>} rawOptions
 */
export function repairAll(rawOptions, allEvents, priorityNames) {
  return (rawOptions ?? []).map((o) => {
    const before = validateAiSchedule(o.schedule ?? [], allEvents, priorityNames);
    const r = repairSchedule(o.schedule ?? [], allEvents, priorityNames);
    return {
      label: o.label,
      rationale: o.rationale,
      schedule: r.schedule,
      valid: r.valid,
      score: r.score,
      wasInvalid: !before.valid,
      beforeReason: before.reason,
      actions: r.actions,
    };
  });
}