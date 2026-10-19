// lib/baseline.js — unchanged from the earlier prototype. Still used as the
// non-AI comparison point, and now also as the pre-filter that narrows
// candidates before they're handed to the scheduling step.

import { matchesInterest } from "./interests.js";

function interestMatchScore(place, interests) {
  if (!interests?.length) return 0.5;
  const matches = interests.filter((i) => matchesInterest(place, i));
  return matches.length / interests.length;
}

function scorePlace(place, interests) {
  const ratingScore = (place.rating ?? 0) / 5;
  const matchScore = interestMatchScore(place, interests);
  return ratingScore * 0.6 + matchScore * 0.4;
}

export function rankPlaces(places, interests) {
  return places
    .map((p) => ({ ...p, score: Number(scorePlace(p, interests).toFixed(3)) }))
    .sort((a, b) => b.score - a.score);
}

export function buildBaselineSchedule(places, interests, hours, minutesPerStop = 90) {
  const maxStops = Math.max(1, Math.floor((hours * 60) / minutesPerStop));
  return rankPlaces(places, interests).slice(0, maxStops);
}