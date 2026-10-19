// lib/optimalScheduler.js
//
// Classic weighted interval scheduling: given events with (start, end) and
// a weight (duration_minutes * 2 if priority, else * 1), find the
// non-overlapping subset that maximizes total weight. This is a dynamic
// program, not an LLM — it gives the true ceiling score, verified to exactly
// reproduce `optimal_score` on all 500 rows of the real
// anakin87/events-scheduling training set.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * @param {Array<{name:string, start:string, end:string}>} events  start/end as "HH:MM"
 * @param {string[]} priorityNames  names of events weighted 2x
 * @returns {{ optimalScore: number, optimalSchedule: object[] }}
 */
export function computeOptimalSchedule(events, priorityNames) {
  const prioritySet = new Set(priorityNames);

  const items = events
    .map((e) => {
      const start = typeof e.start === "string" ? toMinutes(e.start) : e.startMin;
      const end = typeof e.end === "string" ? toMinutes(e.end) : e.endMin;
      const duration = end - start;
      const weight = duration * (prioritySet.has(e.name) ? 2 : 1);
      return { ...e, start, end, weight };
    })
    .sort((a, b) => a.end - b.end);

  const n = items.length;
  const dp = new Array(n + 1).fill(0);
  const choice = new Array(n + 1).fill(false);

  function lastCompatible(i) {
    // last index j (1-based) with items[j-1].end <= items[i-1].start
    for (let k = i - 1; k >= 1; k--) {
      if (items[k - 1].end <= items[i - 1].start) return k;
    }
    return 0;
  }

  for (let i = 1; i <= n; i++) {
    const j = lastCompatible(i);
    const take = dp[j] + items[i - 1].weight;
    const skip = dp[i - 1];
    dp[i] = Math.max(take, skip);
    choice[i] = take > skip;
  }

  // backtrack to recover the chosen events
  const chosen = [];
  let i = n;
  while (i > 0) {
    if (choice[i]) {
      chosen.push(items[i - 1]);
      i = lastCompatible(i);
    } else {
      i -= 1;
    }
  }
  chosen.reverse();

  return { optimalScore: dp[n], optimalSchedule: chosen };
}

/** Returns true if no two events in the schedule overlap in time. */
export function isValidSchedule(schedule) {
  const intervals = schedule
    .map((s) => [typeof s.start === "string" ? toMinutes(s.start) : s.startMin, typeof s.end === "string" ? toMinutes(s.end) : s.endMin])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i][0] < intervals[i - 1][1]) return false; // overlaps previous
  }
  return true;
}

/**
 * Scores an arbitrary (e.g. AI-produced) schedule using the same weight rule.
 * NOTE: this looks up weight by event NAME only — it does not check that the
 * schedule item's start/end actually match the original event. An AI output
 * that invents different times for a real event name is scored here as if
 * it used the original times, which is wrong. Use validateAiSchedule()
 * instead for anything that needs to be trustworthy; this function is kept
 * only for internal use by validateAiSchedule() and for the dataset's own
 * known-correct optimalSchedule objects (which always have real times).
 */
export function scoreSchedule(schedule, allEvents, priorityNames) {
  const prioritySet = new Set(priorityNames);
  const weightByName = new Map(
    allEvents.map((e) => {
      const start = typeof e.start === "string" ? toMinutes(e.start) : e.startMin;
      const end = typeof e.end === "string" ? toMinutes(e.end) : e.endMin;
      return [e.name, (end - start) * (prioritySet.has(e.name) ? 2 : 1)];
    })
  );
  return schedule.reduce((sum, s) => sum + (weightByName.get(s.name) ?? 0), 0);
}

/**
 * Strict validator for AI-produced schedules. Checks, in order:
 *   1. Every event in the schedule appears only once (no duplicates).
 *   2. Every event's name AND start AND end match an original input event
 *      exactly (catches fabricated/altered times, not just fabricated names).
 *   3. No two events in the schedule overlap in time.
 * Only a schedule that passes all three is scored; an invalid schedule
 * always scores 0, rather than silently falling back to a partial or
 * name-only score.
 *
 * @returns {{ valid: boolean, reason: string|null, score: number }}
 */
export function validateAiSchedule(schedule, allEvents, priorityNames) {
  const seenNames = new Set();
  for (const item of schedule) {
    if (seenNames.has(item.name)) {
      return { valid: false, reason: `duplicate event "${item.name}"`, score: 0 };
    }
    seenNames.add(item.name);

    const match = allEvents.find(
      (e) => e.name === item.name && e.start === item.start && e.end === item.end
    );
    if (!match) {
      return {
        valid: false,
        reason: `"${item.name}" at ${item.start}-${item.end} does not exactly match any original event`,
        score: 0,
      };
    }
  }

  if (!isValidSchedule(schedule)) {
    // Name the first conflicting pair so the retry prompt (and the logs) can
    // say exactly what to fix instead of a generic "events overlap".
    const sorted = [...schedule].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        const a = sorted[i - 1];
        const b = sorted[i];
        return {
          valid: false,
          reason: `two or more events overlap: "${a.name}" (${a.start}-${a.end}) overlaps "${b.name}" (${b.start}-${b.end})`,
          score: 0,
        };
      }
    }
    return { valid: false, reason: "two or more events overlap", score: 0 };
  }

  return { valid: true, reason: null, score: scoreSchedule(schedule, allEvents, priorityNames) };
}