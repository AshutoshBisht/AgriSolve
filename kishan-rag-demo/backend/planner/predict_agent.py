# planner/predict_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# PREDICTIVE ANALYSIS AGENT
# Estimates crop yield and revenue using a rule-based model that combines:
#   • District / national average yield data        source: district_avg_yield.json / national_avg_yield.json
#   • Soil type multiplier                           source: soil_yield_factor.json
#   • Weather risk adjustment factor                 source: Open-Meteo via weather_agent
#   • Crop production cost breakdown                 source: crop_costs.json (CACP / ICAR estimates)
#   • MSP-based gross revenue                        source: msps.json (Rabi 2025-26 / Kharif 2025)
# No ML model training required — stable and explainable for farmers.
# ─────────────────────────────────────────────────────────────────────────────

import json
import os
from fastapi import HTTPException

_DATA = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(_DATA, "district_avg_yield.json")) as f:
    _DISTRICT_YIELD: dict = json.load(f)
    _DISTRICT_YIELD.pop("_comment", None)

with open(os.path.join(_DATA, "national_avg_yield.json")) as f:
    _NATIONAL_YIELD: dict = json.load(f)
    _NATIONAL_YIELD.pop("_comment", None)

with open(os.path.join(_DATA, "soil_yield_factor.json")) as f:
    _SOIL_FACTOR: dict = json.load(f)
    _SOIL_FACTOR.pop("_comment", None)

with open(os.path.join(_DATA, "msps.json")) as f:
    _MSP: dict = json.load(f)
    _MSP.pop("_comment", None)

with open(os.path.join(_DATA, "crop_costs.json")) as f:
    _CROP_COSTS: dict = json.load(f)
    _CROP_COSTS.pop("_comment", None)

# Acres to hectares conversion
ACRE_TO_HA = 0.404686


def _weather_factor(risks: list[dict]) -> tuple[float, list[str]]:
    """
    Derive a weather adjustment factor from active risk list.

    Logic:
      High drought  → 0.70
      High heat     → 0.80
      Medium risk   → 0.90
      No/low risk   → 1.00

    Multiple risks stack multiplicatively (capped at 0.60).
    Returns (factor, list of explanation strings).
    """
    factor       = 1.0
    explanations = []

    for risk in risks:
        level = risk.get("level", "Low")
        rtype = risk.get("type", "")

        if level == "High":
            if rtype == "Drought":
                factor *= 0.70
            elif rtype == "Heat":
                factor *= 0.80
            elif rtype == "Flood":
                factor *= 0.75
            elif rtype == "Frost":
                factor *= 0.80
            explanations.append(f"High {rtype} risk (-{int((1 - factor)*100)}% yield)")

        elif level == "Medium":
            factor *= 0.92
            explanations.append(f"Medium {rtype} risk (−8% yield)")

    factor = max(0.60, factor)   # never drop below 60%
    return round(factor, 3), explanations


def predict(
    state:      str,
    district:   str,
    crop:       str,
    land_size_acres: float,
    soil_type:  str,
    weather:    dict,         # output from weather_agent.get_weather()
) -> dict:
    """
    Predict yield and revenue for a crop on the farmer's land.

    Formula:
        predicted_yield_t = base_yield_t_ha
                            × soil_factor
                            × weather_factor
                            × land_size_ha

    Revenue model:
        gross_revenue = predicted_yield_tons × 10 × msp_per_quintal
        total_cost    = (seeds + fertilizer + irrigation + harvesting + labor) per ha × land_ha
        net_profit    = gross_revenue − total_cost

    Returns full calculation breakdown + data sources.
    """
    # ── Base yield ──
    district_key = f"{state}|{crop}"
    base_yield   = _DISTRICT_YIELD.get(district_key) or _NATIONAL_YIELD.get(crop)
    yield_source = "district_avg_yield.json" if district_key in _DISTRICT_YIELD else "national_avg_yield.json"

    if base_yield is None:
        raise HTTPException(
            status_code=404,
            detail=f"No yield data for crop '{crop}'. "
                   f"Available: {list(_NATIONAL_YIELD.keys())}"
        )

    # ── Soil factor ──
    soil_factor = _SOIL_FACTOR.get(soil_type, 1.0)

    # ── Weather factor ──
    risks = weather.get("risks", [])
    weather_factor, risk_explanations = _weather_factor(risks)

    # ── Compute yield ──
    land_ha        = land_size_acres * ACRE_TO_HA
    predicted_tons = base_yield * soil_factor * weather_factor * land_ha
    quintals       = predicted_tons * 10   # 1 tonne = 10 quintals

    # ── Revenue estimate (MSP-based) ──
    msp_per_quintal = _MSP.get(crop)
    gross_revenue   = round(quintals * msp_per_quintal, 0) if msp_per_quintal else None

    # ── Cost breakdown ──
    costs_per_ha  = _CROP_COSTS.get(crop, {})
    total_cost_ha = sum(costs_per_ha.values()) if costs_per_ha else None
    total_cost    = round(total_cost_ha * land_ha, 0) if total_cost_ha else None

    cost_breakdown = None
    if costs_per_ha:
        cost_breakdown = {
            k: round(v * land_ha, 0) for k, v in costs_per_ha.items()
        }
        cost_breakdown["total"] = total_cost

    net_profit = round(gross_revenue - total_cost, 0) if (gross_revenue and total_cost) else None

    # ── Confidence ──
    confidence = (
        "High"   if district_key in _DISTRICT_YIELD and weather_factor >= 0.95 else
        "Medium" if weather_factor >= 0.80 else
        "Low"
    )

    if not risk_explanations:
        risk_explanations = ["Normal weather conditions — no major risks detected"]

    # ── Step-by-step calculation breakdown ──
    calculation_steps = [
        f"Base yield ({yield_source}): {base_yield} t/ha for {crop} in {state}",
        f"Soil factor (soil_yield_factor.json): {soil_type} → ×{soil_factor}",
        f"Weather factor (Open-Meteo risks): ×{weather_factor}  [{'; '.join(risk_explanations)}]",
        f"Land area: {land_size_acres} acres = {round(land_ha, 3)} ha",
        f"Predicted yield: {base_yield} × {soil_factor} × {weather_factor} × {round(land_ha,3)} = {round(predicted_tons, 2)} tonnes",
        f"Quintals: {round(predicted_tons, 2)} × 10 = {round(quintals, 1)} quintals",
    ]
    if msp_per_quintal and gross_revenue is not None:
        calculation_steps.append(
            f"Gross revenue (msps.json MSP): {round(quintals,1)} quintals × ₹{msp_per_quintal}/q = ₹{int(gross_revenue):,}"
        )
    if cost_breakdown and total_cost is not None:
        parts = [f"{k} ₹{int(v):,}" for k, v in cost_breakdown.items() if k != "total"]
        calculation_steps.append(
            f"Total cost (crop_costs.json, CACP estimates): {' + '.join(parts)} = ₹{int(total_cost):,}"
        )
    if net_profit is not None:
        calculation_steps.append(
            f"Net profit: ₹{int(gross_revenue):,} − ₹{int(total_cost):,} = ₹{int(net_profit):,}"
        )

    # ── Data sources ──
    sources = {
        "base_yield":    f"{yield_source} (ICAR / state agriculture dept. district averages)",
        "soil_factor":   "soil_yield_factor.json (ICAR agronomy research, 6 soil classes)",
        "weather_risks": "Open-Meteo API — free real-time forecast, no API key required",
        "crop_costs":    "crop_costs.json (CACP / ICAR 2024-25 cost-of-cultivation estimates)",
        "msp":           "msps.json — Govt. of India MSP notification (Rabi 2025-26 / Kharif 2025)",
        "revenue_note":  "Revenue uses MSP as floor price; actual mandi price may be higher",
    }

    return {
        "crop":                    crop,
        "land_size_acres":         land_size_acres,
        "land_size_ha":            round(land_ha, 3),
        "base_yield_t_ha":         base_yield,
        "soil_factor":             soil_factor,
        "weather_factor":          weather_factor,
        "predicted_yield_tons":    round(predicted_tons, 2),
        "quintals":                round(quintals, 1),
        "msp_per_quintal":         msp_per_quintal,
        "gross_revenue_inr":       int(gross_revenue) if gross_revenue else None,
        "cost_breakdown":          cost_breakdown,
        "total_cost_inr":          int(total_cost) if total_cost else None,
        "net_profit_inr":          int(net_profit) if net_profit else None,
        # keep legacy field name for backward compat
        "estimated_revenue_inr":   int(gross_revenue) if gross_revenue else None,
        "risk_factors":            risk_explanations,
        "confidence":              confidence,
        "calculation_steps":       calculation_steps,
        "sources":                 sources,
    }
