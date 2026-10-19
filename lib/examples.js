// lib/examples.js
//
// Few-shot examples written in the same shape as the
// anakin87/events-scheduling dataset (huggingface.co/datasets/anakin87/events-scheduling):
// a list of events with start/end times, a priority subset, and the optimal
// non-overlapping, weighted-duration-maximizing selection. These are
// hand-written event lists (not rows copied from the dataset), but every
// "optimal schedule" answer below is computed by and verified against
// lib/optimalScheduler.js's weighted-interval-scheduling solver — never
// hand-picked. See verify-examples.js in this folder: it recomputes each
// answer from the solver and fails loudly if any example's listed schedule
// doesn't match exactly, so this file cannot silently drift out of sync
// with the solver again the way Example 2 previously did (it showed an
// *overlapping* pair — History Center 10:45 start before Botanical Garden's
// 11:00 end — labeled as the optimal, non-overlapping answer, which was a
// real bug likely teaching the model the wrong thing).

export const FEW_SHOT_EXAMPLES = [
  {
    prompt: `Events:
- City Museum (10:00 - 12:00)
- Riverside Park (10:30 - 11:30)
- Old Town Walking Tour (11:00 - 13:00)
- Local Diner Lunch (12:15 - 13:15)

Priorities:
- City Museum
- Local Diner Lunch`,
    schedule: [
      { name: "City Museum", start: "10:00", end: "12:00" },
      { name: "Local Diner Lunch", start: "12:15", end: "13:15" },
    ],
    note: "Museum and Lunch are priority (weight 2 each); they don't overlap each other, so both are kept over Riverside Park or the Walking Tour, which conflict with one or both of them.",
  },
  {
    // Corrected: the real optimal picks Botanical Garden (priority) + Rooftop
    // Cafe, since History Center overlaps Botanical Garden (10:45 < 11:00)
    // and is excluded for that reason, not included despite overlapping.
    prompt: `Events:
- Craft Market (09:00 - 10:30)
- Botanical Garden (09:30 - 11:00)
- History Center (10:45 - 12:15)
- Rooftop Cafe (11:00 - 12:00)

Priorities:
- Botanical Garden`,
    schedule: [
      { name: "Botanical Garden", start: "09:30", end: "11:00" },
      { name: "Rooftop Cafe", start: "11:00", end: "12:00" },
    ],
    note: "Botanical Garden is priority and kept. History Center is excluded because it overlaps Botanical Garden (10:45 is before 11:00) even though History Center alone looks valuable — overlap with a kept event always disqualifies a candidate, regardless of its weight. Rooftop Cafe starts exactly when Botanical Garden ends (back-to-back, not overlapping) and is added instead.",
  },
  {
    // New: an explicit near-miss example, since the overlap failures found
    // in evaluation were often close calls (a few minutes of overlap), not
    // obviously-conflicting events.
    prompt: `Events:
- Morning Yoga (07:00 - 08:00)
- Farmers Market (07:45 - 09:15)
- Museum Tour (09:00 - 10:30)
- Coffee Tasting (10:30 - 11:15)

Priorities:
- Museum Tour`,
    schedule: [
      { name: "Morning Yoga", start: "07:00", end: "08:00" },
      { name: "Museum Tour", start: "09:00", end: "10:30" },
      { name: "Coffee Tasting", start: "10:30", end: "11:15" },
    ],
    note: "Farmers Market (07:45-09:15) overlaps BOTH Morning Yoga (ends 08:00, overlap until 08:00) and Museum Tour (starts 09:00, overlap until 09:15), so it must be dropped even though it looks like a safe middle choice. Morning Yoga, Museum Tour, and Coffee Tasting are mutually non-overlapping (Yoga ends 08:00, Museum Tour starts 09:00; Museum Tour ends 10:30, Coffee Tasting starts 10:30 — back-to-back is fine) and together outscore any combination that includes Farmers Market. Check every pair, not just the obvious conflict.",
  },
];

export function formatFewShotForPrompt() {
  return FEW_SHOT_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\n${ex.prompt}\n\nOptimal schedule: ${JSON.stringify(ex.schedule)}`
  ).join("\n\n---\n\n");
}
