"use client";
import { useState } from "react";

import { INTERESTS, BUDGETS, MAX_INTERESTS } from "../lib/interests.js";

export default function Home() {
  const [city, setCity] = useState("Greensboro NC");
  const [budget, setBudget] = useState("medium");
  const [interests, setInterests] = useState(["museums", "coffee"]);
  const [hours, setHours] = useState(6);

  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  function toggleInterest(tag) {
    setInterests((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      return prev.length >= MAX_INTERESTS ? prev : [...prev, tag];
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, budget, interests, hours: Number(hours) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  }

  // Re-runs only the AI step on the same candidate events (no new Places call).
  async function handleRegenerate() {
    if (!result?.events) return;
    setRegenerating(true);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, budget, hours: Number(hours), events: result.events }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setResult((prev) => ({ ...prev, aiOptions: data.aiOptions, aiError: data.aiError }));
    } catch (err) {
      setResult((prev) => ({ ...prev, aiOptions: [], aiError: err.message }));
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>DayCraft</h1>
        <p className="subtitle">
          Real places, a non-AI baseline ranking, and an AI step that proposes
          multiple non-overlapping day schedules instead of one locked plan.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="planner-form">
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          Budget
          <select value={budget} onChange={(e) => setBudget(e.target.value)}>
            {BUDGETS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </label>
        <label>
          Hours available
          <input type="number" min="1" max="12" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <fieldset>
          <legend>Interests (pick up to {MAX_INTERESTS})</legend>
          {INTERESTS.map((i) => (
            <label key={i.id} className="checkbox">
              <input
                type="checkbox"
                checked={interests.includes(i.id)}
                disabled={!interests.includes(i.id) && interests.length >= MAX_INTERESTS}
                onChange={() => toggleInterest(i.id)}
              />
              {i.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Planning..." : "Build my day"}
        </button>
      </form>

      {status === "error" && <p className="error">Error: {errorMsg}</p>}

      {status === "done" && result && (
        <section className="results">
          <h2>Baseline schedule (non-AI, {result.baseline.length} stops)</h2>
          <ol>
            {result.baseline.map((stop) => (
              <li key={stop.id}>
                <strong>{stop.name}</strong> — score {stop.score}
                {stop.rating && <span> · ★ {stop.rating}</span>}
              </li>
            ))}
          </ol>

          <h2>AI-generated options</h2>
          {result.aiError && <p className="error">{result.aiError}</p>}
          {result.aiOptions?.map((opt, i) => (
            <div key={i} className="option">
              <h3>{opt.label}</h3>
              {opt.repaired && (
                <p className="note">
                  Auto-adjusted: the AI's first draft had a conflict, so the conflicting or
                  incorrect stops were removed or reset to their real times.
                </p>
              )}
              <p className="rationale">{opt.rationale}</p>
              <ol>
                {opt.schedule?.map((s, j) => (
                  <li key={j}>
                    {s.start}–{s.end}: {s.name}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <button type="button" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating
              ? "Generating..."
              : result.aiOptions?.length
              ? "Not what you wanted? Generate new options"
              : "Try again"}
          </button>
          <p className="note">
            Every AI option is checked for time conflicts before it is shown. If the AI
            makes a mistake, an automatic repair step removes conflicting stops (marked
            "Auto-adjusted"). If nothing usable comes back, try again or use the baseline above.
          </p>
        </section>
      )}
    </div>
  );
}