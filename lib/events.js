import { matchesInterest } from "./interests.js";

// lib/events.js
//
// Bridges our place data into the "events + priorities" framing used by the
// anakin87/events-scheduling dataset (huggingface.co/datasets/anakin87/events-scheduling):
// given a list of events with start/end times, and a subset marked as
// priority (weight 2 vs. weight 1 for normal events), pick the
// non-overlapping subset that maximizes total weighted duration.
//
// Places don't come with pre-made "event slots," so we manufacture
// reasonable ones: a default visit duration per category, scattered across
// the user's available hours, with deliberate overlaps between same-category
// alternatives so there's an actual scheduling decision to make — mirroring
// how the dataset's generator intentionally creates overlapping events.

const DURATION_BY_TYPE_MIN = {
  museum: 120,
  art_gallery: 90,
  park: 90,
  cafe: 45,
  coffee_shop: 45,
  restaurant: 90,
  shopping_mall: 90,
  tourist_attraction: 100,
  historical_landmark: 75,
};
const DEFAULT_DURATION_MIN = 90;

function estimateDuration(place) {
  for (const t of place.types) {
    if (DURATION_BY_TYPE_MIN[t]) return DURATION_BY_TYPE_MIN[t];
  }
  return DEFAULT_DURATION_MIN;
}

function minutesToClock(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Deterministic hash of a string -> 0..1, so the same place always gets the
// same overlap pattern (repeatable runs) without Math.random().
function hash01(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// Fraction of the visit length to advance before the next candidate starts.
// Varying it per place (instead of a constant 0.5) produces uneven chains:
// sometimes a long event blocks several short ones, sometimes two events
// barely clash. A constant step made every instance a tidy chain that a
// greedy algorithm solves optimally, so the comparison told us little.
const STEP_FRACTIONS = [0.2, 0.35, 0.5, 0.65, 0.8];

/**
 * Turn ranked places into dataset-style events, spread across the day with
 * intentional, uneven overlap so the model has real choices to make.
 * dayStartMin defaults to 9:00 AM (540 minutes).
 *
 * Priority (weight 2x): a place is priority only if it matches one of the
 * user's interests AND is in the top ~40% of the candidates by rank. The old
 * rule (matches any interest) marked every event priority whenever the
 * places had been fetched BY those interests, which made the weighting
 * meaningless.
 *
 * @param {Array} rankedPlaces  output of rankPlaces() — highest score first
 * @param {string[]} interests
 * @param {number} hours        hours available for the day
 * @param {number} dayStartMin  minutes after midnight when the day starts
 * @param {number} candidateCount  how many places to turn into events (keep
 *   this well above how many will actually fit, so overlap is possible)
 */
export function buildEvents(rankedPlaces, interests, hours, dayStartMin = 540, candidateCount = 10) {
  const dayEndMin = dayStartMin + hours * 60;
  const candidates = rankedPlaces.slice(0, candidateCount);
  const priorityCutoff = Math.ceil(candidates.length * 0.4);

  let cursor = dayStartMin;
  const events = candidates.map((place, idx) => {
    const duration = estimateDuration(place);
    const start = cursor;
    const end = Math.min(start + duration, dayEndMin);
    const frac = STEP_FRACTIONS[Math.floor(hash01(place.id ?? place.name) * STEP_FRACTIONS.length)];
    cursor += Math.max(15, Math.round(duration * frac));
    const matchesAny = interests.some((i) => matchesInterest(place, i));
    return {
      name: place.name,
      start: minutesToClock(start),
      end: minutesToClock(end),
      startMin: start,
      endMin: end,
      priority: matchesAny && idx < priorityCutoff,
      placeId: place.id,
      rating: place.rating,
    };
  });

  return events.filter((e) => e.startMin < dayEndMin);
}