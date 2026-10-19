import { fetchPlaces } from "../../../lib/placesApi";
import { rankPlaces, buildBaselineSchedule } from "../../../lib/baseline";
import { buildEvents } from "../../../lib/events";
import { generateScheduleOptionsWithRetry } from "../../../lib/scheduler";

const HHMM = /^\d{2}:\d{2}$/;

// "Try again" sends back the events from the first response so only the AI
// step is re-run (no second Places call). Because that comes from the
// browser, re-check its shape and size before using it in a prompt.
function cleanEvents(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 15) return null;
  const out = [];
  for (const e of raw) {
    if (
      typeof e?.name !== "string" || e.name.length === 0 || e.name.length > 150 ||
      !HHMM.test(e?.start ?? "") || !HHMM.test(e?.end ?? "")
    ) {
      return null;
    }
    out.push({ name: e.name, start: e.start, end: e.end, priority: e.priority === true });
  }
  return out;
}

async function runAi({ city, budget, hours, events, apiKey }) {
  try {
    const result = await generateScheduleOptionsWithRetry({
      city, budget, hours, events, apiKey, maxRetries: 2,
    });
    if (result.succeeded) {
      // Options that passed the strict validator, plus (if there are fewer
      // than 2) auto-fixed versions of the ones that did not.
      const extra = result.validCount < 2 ? result.repairedOptions : [];
      return { aiOptions: [...result.options, ...extra].slice(0, 3), aiError: null };
    }
    if (result.repairedOptions.length > 0) {
      // Nothing validated, but the repair step produced safe schedules from the AI's own picks.
      return { aiOptions: result.repairedOptions.slice(0, 3), aiError: null };
    }
    return {
      aiOptions: [],
      aiError: "The AI could not produce a conflict-free schedule this time. Try again for a new set of options.",
    };
  } catch (err) {
    return { aiOptions: [], aiError: err.message };
  }
}

export async function POST(request) {
  try {
    const { city, budget, interests = [], hours, events: clientEvents } = await request.json();
    if (!city || !budget || !hours) {
      return Response.json({ error: "city, budget, and hours are required." }, { status: 400 });
    }

    // Regenerate: AI step only, on the events already shown to the user.
    if (clientEvents !== undefined) {
      const events = cleanEvents(clientEvents);
      if (!events) return Response.json({ error: "Invalid events." }, { status: 400 });
      const ai = await runAi({ city, budget, hours, events, apiKey: process.env.OPENAI_API_KEY });
      return Response.json(ai);
    }

    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const places = await fetchPlaces({ city, interests, budget, apiKey: placesKey });
    const ranked = rankPlaces(places, interests);
    const baselineSchedule = buildBaselineSchedule(places, interests, hours);
    
    const events = buildEvents(ranked, interests, hours);

    const { aiOptions, aiError } = await runAi({
      city, budget, hours, events, apiKey: openaiKey,
    });

    return Response.json({
      placeCount: places.length,
      baseline: baselineSchedule,
      events,
      aiOptions,
      aiError,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}