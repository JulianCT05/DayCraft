// lib/interests.js
//
// Single source of truth for the interest and budget choices. Used by the UI
// (what to show), the Places search (what to query), and the ranking/priority
// logic (which Google place types count as a match).
//
// Why this exists: the UI used to offer words like "museums" and "parks" but
// the matching code looked for that exact text inside Google's type names
// ("museum", "park"), so those two interests silently never matched. Each
// interest now lists the Google place types it covers.
//
// A type pattern starting with "*" matches any type that ENDS with the rest
// (e.g. "*restaurant" matches "thai_restaurant").

export const INTERESTS = [
  { id: "museums", label: "Museums", query: "museums", aliases: ["museum"], types: ["museum", "art_museum", "history_museum"] },
  { id: "parks", label: "Parks", query: "parks", aliases: ["park"], types: ["park", "city_park", "national_park", "state_park"] },
  { id: "outdoors", label: "Outdoors & gardens", query: "gardens and nature trails", aliases: ["nature", "garden", "gardens", "hiking"], types: ["garden", "botanical_garden", "nature_preserve", "hiking_area", "wildlife_park"] },
  { id: "coffee", label: "Coffee & cafes", query: "coffee shops", aliases: ["cafe", "cafes", "coffee shop"], types: ["coffee_shop", "cafe", "tea_house"] },
  { id: "food", label: "Restaurants", query: "restaurants", aliases: ["restaurant", "dining"], types: ["restaurant", "*_restaurant", "meal_takeaway"] },
  { id: "desserts", label: "Desserts & bakeries", query: "dessert shops and bakeries", aliases: ["dessert", "bakery", "bakeries", "ice cream"], types: ["dessert_shop", "ice_cream_shop", "bakery", "pastry_shop"] },
  { id: "nightlife", label: "Bars & nightlife", query: "bars and nightlife", aliases: ["bar", "bars"], types: ["bar", "*_bar", "night_club", "pub", "brewery"] },
  { id: "shopping", label: "Shopping", query: "shopping", aliases: ["shop", "shops"], types: ["shopping_mall", "store", "*_store", "market"] },
  { id: "history", label: "History & landmarks", query: "historic landmarks", aliases: ["historic", "landmarks"], types: ["historical_landmark", "historical_place", "history_museum", "monument", "cultural_landmark"] },
  { id: "art", label: "Art & galleries", query: "art galleries", aliases: ["gallery", "galleries"], types: ["art_gallery", "art_museum", "art_studio"] },
  { id: "music", label: "Music & theater", query: "live music and theaters", aliases: ["theater", "theatre", "concert", "music"], types: ["live_music_venue", "performing_arts_theater", "concert_hall", "movie_theater", "amphitheatre"] },
  { id: "family", label: "Family fun", query: "family attractions", aliases: ["kids", "family"], types: ["playground", "zoo", "aquarium", "amusement_park", "indoor_playground", "water_park"] },
  { id: "sports", label: "Sports & activities", query: "sports and recreation", aliases: ["sport", "recreation"], types: ["stadium", "sports_complex", "sports_activity_location", "athletic_field", "golf_course", "bowling_alley"] },
  { id: "books", label: "Books & libraries", query: "bookstores and libraries", aliases: ["book", "bookstore", "library"], types: ["book_store", "library"] },
];

// Budget is cumulative: choosing "Up to $$" also includes free and $ places.
// Google gives no price for many attractions (parks, most museums), and those
// are kept at every level rather than being treated as unknown cost.
export const BUDGETS = [
  { id: "free", label: "Free only", levels: ["PRICE_LEVEL_FREE"] },
  { id: "low", label: "Up to $", levels: ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE"] },
  { id: "medium", label: "Up to $$", levels: ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"] },
  { id: "high", label: "Up to $$$", levels: ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE"] },
  { id: "any", label: "Any budget ($$$$)", levels: null },
];

export const MAX_INTERESTS = 6;

export function findInterest(name) {
  const key = String(name ?? "").trim().toLowerCase();
  return (
    INTERESTS.find((i) => i.id === key || i.aliases.includes(key)) ??
    INTERESTS.find((i) => i.id === `${key}s`) ??
    null
  );
}

export function searchQueryFor(name) {
  return findInterest(name)?.query ?? String(name);
}

function typeMatches(placeType, pattern) {
  return pattern.startsWith("*") ? placeType.endsWith(pattern.slice(1)) : placeType === pattern;
}


export function matchesInterest(place, name) {
  const def = findInterest(name);
  const types = place.types ?? [];
  if (!def) {
    const text = types.join(" ").toLowerCase();
    return text.includes(String(name).toLowerCase());
  }
  return types.some((t) => def.types.some((p) => typeMatches(t, p)));
}

export function priceLevelsFor(budgetId) {
  return BUDGETS.find((b) => b.id === budgetId)?.levels ?? null;
}