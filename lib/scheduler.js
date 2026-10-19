// lib/scheduler.js
//
// Prompts an LLM using the same task framing as the anakin87/events-scheduling
// dataset: given events (name, start, end) and a priority subset (weight 2
// vs weight 1), pick the non-overlapping set that maximizes total weighted
// duration. We ask for 2-3 *labeled* variants instead of one locked answer —
// that's the actual research question from the proposal (does showing
// options beat a single rigid plan).


import { formatFewShotForPrompt } from "./examples.js";
import { formatPlaceExamplesForPrompt } from "./placeExamples.js";
import { validateAiSchedule } from "./optimalScheduler.js";
import { repairAll } from "./repair.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

function formatEventsList(events) {
  return events
    .map((e) => `- ${e.name} (${e.start} - ${e.end})`)
    .join("\n");
}

function formatPriorities(events) {
  const priorityNames = events.filter((e) => e.priority).map((e) => e.name);
  return priorityNames.length ? priorityNames.map((n) => `- ${n}`).join("\n") : "(none)";
}

export function buildDatasetStylePrompt({ city, budget, hours, events }) {
  return `Events:
${formatEventsList(events)}

Priorities:
${formatPriorities(events)}

Context: planning a single day in ${city}, budget tier "${budget}", ${hours} hours available.`;
}

const SYSTEM_PROMPT = `You are a scheduling assistant. Given a list of events with start/end times \
and a set of priority events, select the subset of NON-OVERLAPPING events that maximizes total \
weighted duration (priority events count 2x their duration, normal events count 1x). \

Instead of one answer, produce 2 or 3 DISTINCT labeled schedule options so the user has real \
choices rather than one locked-in plan. Each option must itself be internally non-overlapping. \
Vary the options meaningfully (e.g. one maximizes priority coverage, one maximizes number of \
distinct stops, one is the most time-efficient).

Respond ONLY with JSON in this exact shape:
{
  "options": [
    { "label": "string", "rationale": "one sentence", "schedule": [ { "name": "string", "start": "HH:MM", "end": "HH:MM" } ] }
  ]
}

Worked examples of selecting the optimal non-overlapping, weighted-duration-maximizing set:

${formatFewShotForPrompt()}

Style examples for how to write labels and rationales for real itinerary stops:

${formatPlaceExamplesForPrompt()}`;

export const DEFAULT_MODEL = "gpt-4o-mini";

async function callOpenAI(messages, apiKey, model = DEFAULT_MODEL) {
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }
  return { raw, options: parsed.options ?? [] };
}

/** Single call, no checking — the original behaviour (kept as the no-retry baseline). */
export async function generateScheduleOptions({ city, budget, hours, events, apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) throw new Error("Missing OpenAI API key.");
  const userPrompt = buildDatasetStylePrompt({ city, budget, hours, events });
  const { options } = await callOpenAI(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    apiKey,
    model
  );
  return options;
}

function describeFailures(failed) {
  return failed.map((f) => `- "${f.label}": ${f.reason}`).join("\n");
}

/**
 * Generate options, then CHECK them with the same strict validator the
 * evaluation uses (exact name+start+end match to an input event, no
 * duplicates, no overlaps). Options that fail are sent back to the model
 * with the specific reason, up to `maxRetries` times. Valid options are kept
 * across attempts (de-duplicated by label), so a retry can only add to the
 * valid set, never lose one.
 *
 * Returns:
 *   options  — the valid options collected (or, if NONE ever validated, the
 *              last attempt's raw options, so callers can see/score the
 *              failure rather than getting an empty list silently)
 *   validCount, attempts (array of per-attempt raw options + per-option
 *   validity, for logging), succeeded (true if >=1 valid option)
 *
 * @param {number} maxRetries  extra attempts after the first (0 = same as
 *   generateScheduleOptions plus validation info)
 * @param {number} minValid    stop retrying once this many options are valid
 */
export async function generateScheduleOptionsWithRetry({
  city, budget, hours, events, apiKey, maxRetries = 2, minValid = 2, model = DEFAULT_MODEL,
}) {
  if (!apiKey) throw new Error("Missing OpenAI API key.");

  const plain = events.map((e) => ({ name: e.name, start: e.start, end: e.end }));
  const priorityNames = events.filter((e) => e.priority).map((e) => e.name);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildDatasetStylePrompt({ city, budget, hours, events }) },
  ];

  const attempts = [];
  const validByLabel = new Map();
  let lastOptions = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { raw, options } = await callOpenAI(messages, apiKey, model);
    lastOptions = options;

    const checked = options.map((o) => {
      const r = validateAiSchedule(o.schedule ?? [], plain, priorityNames);
      return { label: o.label, valid: r.valid, reason: r.reason, score: r.score };
    });
    attempts.push({ rawOptions: options, checked });

    options.forEach((o, i) => {
      if (checked[i].valid && !validByLabel.has(o.label)) validByLabel.set(o.label, o);
    });

    if (validByLabel.size >= minValid || attempt === maxRetries) break;

    const failed = checked.filter((c) => !c.valid);
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        `Your response had problems:\n${describeFailures(failed)}\n\n` +
        `Rules: use ONLY events from the input list, copy each event's name, start and end EXACTLY as given ` +
        `(never change a time), use each event at most once, and make sure no two chosen events overlap ` +
        `(an event may start exactly when another ends). If two events conflict, drop one of them. ` +
        `Respond again with the full corrected JSON, with ${minValid} or 3 distinct options.`,
    });
  }

  const valid = [...validByLabel.values()];

  const seen = new Set(validByLabel.keys());
  const repairedOptions = [];
  for (const r of repairAll(attempts.flatMap((a) => a.rawOptions), plain, priorityNames)) {
    if (r.wasInvalid && r.valid && r.schedule.length > 0 && !seen.has(r.label)) {
      seen.add(r.label);
      repairedOptions.push({ label: r.label, rationale: r.rationale, schedule: r.schedule, repairActions: r.actions, repaired: true });
    }
  }

  return {
    repairedOptions,
    options: valid.length ? valid : lastOptions,
    validCount: valid.length,
    succeeded: valid.length > 0,
    attempts,
  };
}