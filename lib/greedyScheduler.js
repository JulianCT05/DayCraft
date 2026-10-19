// lib/greedyScheduler.js
//
// A naive non-AI baseline for the abstract events+priorities task (distinct
// from lib/baseline.js, which ranks real places). Two-pass greedy: take
// priority events first (by earliest end time, skipping conflicts), then
// fill remaining gaps with normal events the same way. This is what the
// evaluation script compares against the true optimum and against the AI.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

export function greedySchedule(events, priorityNames) {
  const prioritySet = new Set(priorityNames);
  const withMin = events.map((e) => ({
    ...e,
    start: toMinutes(e.start),
    end: toMinutes(e.end),
  }));

  const priorityEvents = withMin.filter((e) => prioritySet.has(e.name)).sort((a, b) => a.end - b.end);
  const normalEvents = withMin.filter((e) => !prioritySet.has(e.name)).sort((a, b) => a.end - b.end);

  const chosen = [];
  for (const e of [...priorityEvents, ...normalEvents]) {
    if (!chosen.some((c) => overlaps(c, e))) chosen.push(e);
  }
  return chosen.sort((a, b) => a.start - b.start);
}
