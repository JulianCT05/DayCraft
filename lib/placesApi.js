import { searchQueryFor, priceLevelsFor, MAX_INTERESTS } from "./interests.js";

// lib/placesApi.js — same Text Search logic as the earlier prototype, now
// called only from app/api/plan/route.js, so the API key never reaches the
// browser.

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.priceRange",
  "places.currentOpeningHours",
  "places.types",
  "places.location",
].join(",");

async function searchText(query, apiKey) {
  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 10 }),
  });
  if (!res.ok) {
    console.error(`Places API error (${res.status}) for "${query}":`, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json();
  return data.places ?? [];
}

export async function fetchPlaces({ city, interests, budget, apiKey }) {
  if (!apiKey) throw new Error("Missing Google Places API key.");
  if (!city) throw new Error("City is required.");

  // Cap the number of searches (one Places request per interest) to keep cost bounded.
  const chosen = (interests ?? []).slice(0, MAX_INTERESTS);
  const queries = (chosen.length ? chosen : ["things to do"]).map(
    (interest) => `${searchQueryFor(interest)} in ${city}`
  );
  const resultsPerQuery = await Promise.all(queries.map((q) => searchText(q, apiKey)));

  const seen = new Map();
  for (const place of resultsPerQuery.flat()) {
    if (place.id && !seen.has(place.id)) seen.set(place.id, place);
  }

  const allowedPriceLevels = priceLevelsFor(budget);

  return [...seen.values()]
    .filter((p) => !allowedPriceLevels || !p.priceLevel || allowedPriceLevels.includes(p.priceLevel))
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress ?? "",
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? 0,
      priceLevel: p.priceLevel ?? null,
      priceRange: p.priceRange ?? null,
      openNow: p.currentOpeningHours?.openNow ?? null,
      types: p.types ?? [],
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    }));
}