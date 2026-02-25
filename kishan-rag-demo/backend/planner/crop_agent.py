# planner/crop_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# CROP SELECTION AGENT
# Uses a rule-based engine (crop_rules.json) combined with live weather data
# from the Weather Agent to recommend the top 3 crops for a farmer's location
# and season.  Gemini 2.5 Flash generates a short "why this crop" explanation
# for each recommendation.
# ─────────────────────────────────────────────────────────────────────────────

import json
import os
from datetime import date
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Path to data folder (same directory as this file)
_DATA = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(_DATA, "crop_rules.json")) as f:
    CROP_RULES: list[dict] = json.load(f)


# ── Season detection ─────────────────────────────────────────────────────────

def _current_season() -> str:
    """
    Determine the Indian agricultural season based on current month.
      Kharif : June – October  (monsoon crops, sown after rains arrive)
      Rabi   : November – March (winter crops, sown after monsoon retreats)
      Zaid   : March – May     (summer / inter-season crops)
    """
    month = date.today().month
    if 6 <= month <= 10:
        return "Kharif"
    if month <= 3 or month >= 11:
        return "Rabi"
    return "Zaid"


# ── Risk scoring ─────────────────────────────────────────────────────────────

def _score_crop(rule: dict, temp_avg: float, rain_monthly: float, season: str) -> int:
    """
    Compute a 0–100 suitability score for a crop given current weather.

    Scoring logic:
      Start at 70 (neutral).
      +15 if the crop's season matches the current season.
      -20 if rainfall is below the crop's minimum requirement.
      -15 if average temperature exceeds the crop's comfort ceiling (+3°C buffer).
      -10 if there is excess rainfall (> 3× minimum requirement — waterlogging risk).
    """
    score = 70

    # Season bonus
    if season in rule.get("seasons", []):
        score += 15

    # Temperature stress
    if temp_avg > rule["max_temp"] + 3:
        score -= 15
    elif temp_avg < rule["min_temp"] - 3:
        score -= 10

    # Rainfall check
    min_rain = rule.get("min_rain_mm_month", 0)
    if rain_monthly < min_rain * 0.5:
        score -= 20          # severe drought condition
    elif rain_monthly < min_rain:
        score -= 10          # mild deficit
    elif rain_monthly > min_rain * 3 and min_rain > 0:
        score -= 10          # excess / waterlogging risk

    return max(0, min(100, score))


def _risk_label(score: int) -> str:
    if score >= 80:
        return "Low"
    if score >= 60:
        return "Medium"
    return "High"


# ── Gemini explanation ────────────────────────────────────────────────────────

def _explain_crop(crop_name: str, district: str, state: str, season: str, score: int) -> str:
    """
    Ask Gemini to write a 2-sentence explanation of why this crop is being
    recommended for this specific farmer. Returns plain text.
    """
    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = (
            f"A farmer in {district}, {state} is in the {season} season. "
            f"AgriSolve recommends {crop_name} with a suitability score of {score}/100. "
            "Write exactly 2 plain-English sentences (no markdown, no lists) explaining "
            "why this crop suits their location and season right now. Keep it practical."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        # Fallback to static note from the rules file if Gemini fails
        for r in CROP_RULES:
            if r["crop"] == crop_name:
                return r.get("notes", "Suitable for your current conditions.")
        return "Suitable for your current conditions."


# ── Main function ─────────────────────────────────────────────────────────────

def recommend_crops(
    district: str,
    state: str,
    soil_type: str,
    weather: dict,        # output of weather_agent.get_weather()
) -> dict:
    """
    Score all crops in the rules database and return the top 3.

    Args:
        district:  farmer's district
        state:     farmer's state
        soil_type: one of Loamy / Sandy / Clay / Black / Red / Alluvial
        weather:   dict returned by weather_agent.get_weather()

    Returns:
        {
            "season": str,
            "top_crops": [
                {
                    "name": str,
                    "risk": "Low"|"Medium"|"High",
                    "score": int,
                    "water_req": str,
                    "yield_range": str,
                    "why": str        ← Gemini explanation
                },
                ...  (up to 3)
            ]
        }
    """
    season = _current_season()

    # Compute average temperature and estimated monthly rainfall from 7-day forecast
    forecast_7d = weather.get("forecast_7d", [])
    if forecast_7d:
        temps = [(d.get("temp_max", 25) + d.get("temp_min", 15)) / 2 for d in forecast_7d]
        temp_avg = sum(temps) / len(temps)
        # Annualise 7-day rain to monthly equivalent for comparison with min_rain_mm_month
        rain_7d = sum(d.get("rain_mm", 0) for d in forecast_7d)
        rain_monthly = rain_7d * (30 / 7)
    else:
        temp_avg, rain_monthly = 25.0, 50.0   # sensible Indian defaults

    # Score every crop rule
    scored = []
    for rule in CROP_RULES:
        # Only include crops that can grow in the farmer's soil type
        if soil_type not in rule.get("soils", []):
            continue
        s = _score_crop(rule, temp_avg, rain_monthly, season)
        scored.append((s, rule))

    # Sort by score descending, take top 3
    scored.sort(key=lambda x: x[0], reverse=True)
    top3 = scored[:3]

    results = []
    for score, rule in top3:
        why = _explain_crop(rule["crop"], district, state, season, score)
        results.append({
            "name":        rule["crop"],
            "risk":        _risk_label(score),
            "score":       score,
            "water_req":   rule.get("water_req", "Unknown"),
            "yield_range": rule.get("yield_range", "Varies"),
            "why":         why,
        })

    return {
        "season": season,
        "top_crops": results,
        "scoring_inputs": {
            "avg_temp_c":        round(temp_avg, 1),
            "est_monthly_rain_mm": round(rain_monthly, 1),
            "soil_type":         soil_type,
            "season_detected":   season,
        },
        "sources": {
            "crop_rules":      "crop_rules.json — 18-crop rule database (soil, temp, rainfall thresholds)",
            "weather_data":    "Open-Meteo API — 7-day forecast, no API key required",
            "season_logic":    f"Calendar-based detection: Kharif (Jun–Oct), Rabi (Nov–Mar), Zaid (Mar–May) → {season}",
            "scoring_formula": "Score = 70 base +15 (season match) ±10–20 (temp/rain stress). Top 3 soil-compatible crops returned.",
            "explanation_ai":  "Gemini 2.0 Flash (Google AI) — 2-sentence crop rationale per recommendation",
        }
    }
