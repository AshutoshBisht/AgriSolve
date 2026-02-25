# planner/weather_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# WEATHER & RISK AGENT
# Supports three views:
#   weekly   – 7-day daily forecast (default)
#   monthly  – 30-day data grouped into 4 weekly summaries
#   seasonal – Current season (Kharif/Rabi/Zaid) overview + crop advice
# Uses Open-Meteo (free, no API key needed).
# ─────────────────────────────────────────────────────────────────────────────

import httpx
import asyncio
from datetime import date, timedelta
from fastapi import HTTPException

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE  = "https://archive-api.open-meteo.com/v1/archive"

# ── Season helpers ────────────────────────────────────────────────────────────

def _current_season() -> str:
    month = date.today().month
    if 6 <= month <= 10:
        return "Kharif"
    if month <= 3 or month >= 11:
        return "Rabi"
    return "Zaid"


# Season → (start_month, end_month, months_count, crops)
_SEASON_META = {
    "Kharif": {
        "months":        ["Jun", "Jul", "Aug", "Sep", "Oct"],
        "month_nums":    [6, 7, 8, 9, 10],
        "description":   "Monsoon season (June–October). Sown with onset of rains, harvested in autumn.",
        "top_crops":     ["Rice", "Cotton", "Maize", "Soybean", "Groundnut", "Bajra", "Jowar"],
        "advisory":      "Ensure field drainage to prevent waterlogging. Monitor for fungal diseases during high-humidity periods.",
    },
    "Rabi": {
        "months":        ["Nov", "Dec", "Jan", "Feb", "Mar"],
        "month_nums":    [11, 12, 1, 2, 3],
        "description":   "Winter season (November–March). Uses residual soil moisture; irrigated crops.",
        "top_crops":     ["Wheat", "Mustard", "Chickpea", "Lentil", "Barley", "Potato", "Peas"],
        "advisory":      "Watch for frost events in December–January. Ensure adequate irrigation at critical growth stages.",
    },
    "Zaid": {
        "months":        ["Mar", "Apr", "May"],
        "month_nums":    [3, 4, 5],
        "description":   "Summer/inter-season (March–May). Short-duration crops between Rabi harvest and Kharif sowing.",
        "top_crops":     ["Watermelon", "Cucumber", "Muskmelon", "Moong Dal", "Bitter Gourd", "Pumpkin"],
        "advisory":      "High temperatures expected. Ensure adequate irrigation and mulching to conserve soil moisture.",
    },
}





# ── helpers ──────────────────────────────────────────────────────────────────

def _risk_level(score: int) -> str:
    """Convert 0–100 score to Low / Medium / High label."""
    if score >= 70:
        return "High"
    if score >= 35:
        return "Medium"
    return "Low"


def _assess_risks(forecast_days: list[dict], hist_rain_30d: list[float]) -> list[dict]:
    """
    Apply simple threshold rules to derive four farm risks.

    Rules (tuned for Indian agricultural context):
      Frost   – any forecast min_temp < 4°C
      Heat    – 3+ consecutive days max_temp > 40°C
      Flood   – any single day precipitation > 50 mm
      Drought – total rainfall over 14-day forecast < 5 mm AND
                historical 30-day total < 20 mm
    """
    risks = []

    temps_min  = [d["temp_min"]  for d in forecast_days]
    temps_max  = [d["temp_max"]  for d in forecast_days]
    rain_fcst  = [d["rain_mm"]   for d in forecast_days]

    # ── Frost ──
    frost_days = [t for t in temps_min if t is not None and t < 4]
    if frost_days:
        score = min(100, len(frost_days) * 25)
        risks.append({
            "type": "Frost",
            "level": _risk_level(score),
            "reason": f"Minimum temps below 4°C expected on {len(frost_days)} day(s)"
        })

    # ── Heat ──
    hot_streak = 0
    max_streak = 0
    for t in temps_max:
        if t is not None and t > 40:
            hot_streak += 1
            max_streak = max(max_streak, hot_streak)
        else:
            hot_streak = 0
    if max_streak >= 3:
        score = min(100, max_streak * 20)
        risks.append({
            "type": "Heat",
            "level": _risk_level(score),
            "reason": f"{max_streak} consecutive days with temperature above 40°C forecast"
        })

    # ── Flood ──
    heavy_rain_days = [r for r in rain_fcst if r is not None and r > 50]
    if heavy_rain_days:
        score = min(100, len(heavy_rain_days) * 35)
        risks.append({
            "type": "Flood",
            "level": _risk_level(score),
            "reason": f"Heavy rainfall (>50mm) expected on {len(heavy_rain_days)} day(s)"
        })

    # ── Drought ──
    rain_14d_list = [r for r in (rain_fcst[:14] if len(rain_fcst) >= 14 else rain_fcst) if r is not None]
    rain_hist_list = [r for r in hist_rain_30d if r is not None]
    rain_14d  = sum(rain_14d_list)
    rain_hist = sum(rain_hist_list)
    if rain_14d < 5 and rain_hist < 20:
        score = 75 if rain_hist < 5 else 50
        risks.append({
            "type": "Drought",
            "level": _risk_level(score),
            "reason": f"Only {rain_14d:.1f}mm forecast in next 14 days; {rain_hist:.0f}mm in last 30 days"
        })

    return risks


# ── main function ─────────────────────────────────────────────────────────────

async def get_weather(lat: float, lon: float, view: str = "weekly") -> dict:
    """
    Fetch weather data for a farm location.

    view:
      "weekly"   – 7-day daily forecast + risks  (default)
      "monthly"  – 4-week aggregated summaries over ~30 days
      "seasonal" – Current season overview (Kharif/Rabi/Zaid) + crop advice
    """
    if view == "monthly":
        return await _get_weather_monthly(lat, lon)
    if view == "seasonal":
        return await _get_weather_seasonal(lat, lon)
    return await _get_weather_weekly(lat, lon)


async def _get_weather_weekly(lat: float, lon: float) -> dict:
    """Original weekly view – 7/16-day forecast + farm risks."""
    today      = date.today()
    hist_start = (today - timedelta(days=30)).isoformat()
    hist_end   = (today - timedelta(days=1)).isoformat()

    params_forecast = {
        "latitude":  lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "forecast_days": 16,
        "timezone": "Asia/Kolkata",
    }

    params_hist = {
        "latitude":  lat,
        "longitude": lon,
        "start_date": hist_start,
        "end_date":   hist_end,
        "daily": "precipitation_sum",
        "timezone": "Asia/Kolkata",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r_forecast, r_hist = await asyncio.gather(
                client.get(OPEN_METEO_FORECAST, params=params_forecast),
                client.get(OPEN_METEO_ARCHIVE,  params=params_hist),
            )
            r_forecast.raise_for_status()
            r_hist.raise_for_status()

        forecast_data = r_forecast.json()
        hist_data     = r_hist.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Weather API error: {exc}")

    daily     = forecast_data.get("daily", {})
    dates     = daily.get("time", [])
    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    rain_list = daily.get("precipitation_sum", [])

    forecast_days = []
    for i, d in enumerate(dates):
        forecast_days.append({
            "date":     d,
            "temp_max": max_temps[i] if i < len(max_temps) else None,
            "temp_min": min_temps[i] if i < len(min_temps) else None,
            "rain_mm":  rain_list[i]  if i < len(rain_list)  else 0.0,
        })

    current = forecast_days[0] if forecast_days else {}
    hist_rain_list = hist_data.get("daily", {}).get("precipitation_sum", [])
    hist_rain_list = [r if r is not None else 0.0 for r in hist_rain_list]
    risks = _assess_risks(forecast_days, hist_rain_list)

    return {
        "view":            "weekly",
        "current": current,
        "forecast": forecast_days,
        "forecast_7d": forecast_days[:7],
        "rain_30d_total": round(sum(hist_rain_list), 1),
        "risks": risks,
        "data_sources": {
            "forecast":        f"Open-Meteo Forecast API — {lat},{lon} — {today.isoformat()} → +16 days",
            "historical_rain": f"Open-Meteo Archive API — {hist_start} to {hist_end} (30 days)",
            "variables":       "temperature_2m_max, temperature_2m_min, precipitation_sum",
            "timezone":        "Asia/Kolkata",
            "cost":            "Free, no API key required",
            "risk_rules": {
                "Frost":   "Any forecast min_temp < 4°C",
                "Heat":    "≥3 consecutive days with max_temp > 40°C",
                "Flood":   "Any single day precipitation > 50 mm",
                "Drought": "14-day forecast total < 5 mm AND 30-day historical < 20 mm",
            },
        },
    }


async def _get_weather_monthly(lat: float, lon: float) -> dict:
    """
    Monthly view: combine last-14-days archive + 16-day forecast → 30 days.
    Returns 4 weekly aggregated summaries.
    """
    today      = date.today()
    arch_start = (today - timedelta(days=14)).isoformat()
    arch_end   = (today - timedelta(days=1)).isoformat()

    params_forecast = {
        "latitude":  lat, "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "forecast_days": 16,
        "timezone": "Asia/Kolkata",
    }
    params_arch = {
        "latitude":  lat, "longitude": lon,
        "start_date": arch_start, "end_date": arch_end,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "Asia/Kolkata",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r_fcst, r_arch = await asyncio.gather(
                client.get(OPEN_METEO_FORECAST, params=params_forecast),
                client.get(OPEN_METEO_ARCHIVE,  params=params_arch),
            )
            r_fcst.raise_for_status()
            r_arch.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Weather API error: {exc}")

    def _parse_daily(data: dict) -> list[dict]:
        d = data.get("daily", {})
        out = []
        for i, dt in enumerate(d.get("time", [])):
            out.append({
                "date":     dt,
                "temp_max": d.get("temperature_2m_max", [])[i] if i < len(d.get("temperature_2m_max", [])) else None,
                "temp_min": d.get("temperature_2m_min", [])[i] if i < len(d.get("temperature_2m_min", [])) else None,
                "rain_mm":  (d.get("precipitation_sum", [])[i] or 0.0) if i < len(d.get("precipitation_sum", [])) else 0.0,
            })
        return out

    arch_days = _parse_daily(r_arch.json())
    fcst_days = _parse_daily(r_fcst.json())

    # Combine: historical (past 14) + forecast (next 16) = ~30 days
    all_days = arch_days + fcst_days
    all_days = all_days[:30]

    # Group into 4 weeks
    weeks = []
    labels = [
        f"Week 1 (past 14 days, days 1–7)",
        f"Week 2 (past → now, days 8–14)",
        f"Week 3 (forecast, days 15–21)",
        f"Week 4 (forecast, days 22–30)",
    ]
    for w in range(4):
        chunk = all_days[w * 7: (w + 1) * 7]
        if not chunk:
            continue
        valid_max  = [d["temp_max"] for d in chunk if d["temp_max"] is not None]
        valid_min  = [d["temp_min"] for d in chunk if d["temp_min"] is not None]
        total_rain = sum(d["rain_mm"] for d in chunk)
        weeks.append({
            "week":           w + 1,
            "label":          labels[w] if w < len(labels) else f"Week {w+1}",
            "date_start":     chunk[0]["date"],
            "date_end":       chunk[-1]["date"],
            "avg_max_temp":   round(sum(valid_max) / len(valid_max), 1) if valid_max else None,
            "avg_min_temp":   round(sum(valid_min) / len(valid_min), 1) if valid_min else None,
            "total_rain_mm":  round(total_rain, 1),
            "days":           len(chunk),
            "is_forecast":    w >= 2,  # weeks 3+ are forecast
        })

    total_rain_30d = round(sum(d["rain_mm"] for d in all_days), 1)
    avg_max = round(sum(d["temp_max"] for d in all_days if d["temp_max"]) / len([d for d in all_days if d["temp_max"]]), 1) if all_days else 0
    avg_min = round(sum(d["temp_min"] for d in all_days if d["temp_min"]) / len([d for d in all_days if d["temp_min"]]), 1) if all_days else 0

    return {
        "view":           "monthly",
        "weeks":          weeks,
        "summary": {
            "total_rain_mm":  total_rain_30d,
            "avg_max_temp":   avg_max,
            "avg_min_temp":   avg_min,
            "period_days":    len(all_days),
        },
        "data_sources": {
            "archive":  f"Open-Meteo Archive — {arch_start} to {arch_end}",
            "forecast": f"Open-Meteo Forecast — {today.isoformat()} to +16 days",
            "cost":     "Free, no API key required",
        },
    }


async def _get_weather_seasonal(lat: float, lon: float) -> dict:
    """
    Seasonal view: determine current Kharif/Rabi/Zaid season, fetch
    past 90 days of archive data, aggregate monthly, and return crop advice.
    """
    today   = date.today()
    season  = _current_season()
    meta    = _SEASON_META[season]

    # Fetch past 90 days of archive data
    arch_start = (today - timedelta(days=90)).isoformat()
    arch_end   = (today - timedelta(days=1)).isoformat()

    params_arch = {
        "latitude":  lat, "longitude": lon,
        "start_date": arch_start, "end_date": arch_end,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "Asia/Kolkata",
    }
    # Also get 16-day forecast
    params_fcst = {
        "latitude":  lat, "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "forecast_days": 16,
        "timezone": "Asia/Kolkata",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r_arch, r_fcst = await asyncio.gather(
                client.get(OPEN_METEO_ARCHIVE,  params=params_arch),
                client.get(OPEN_METEO_FORECAST, params=params_fcst),
            )
            r_arch.raise_for_status()
            r_fcst.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Weather API error: {exc}")

    def _parse(data: dict) -> list[dict]:
        d = data.get("daily", {})
        out = []
        for i, dt in enumerate(d.get("time", [])):
            out.append({
                "date":     dt,
                "temp_max": d.get("temperature_2m_max", [])[i] if i < len(d.get("temperature_2m_max", [])) else None,
                "temp_min": d.get("temperature_2m_min", [])[i] if i < len(d.get("temperature_2m_min", [])) else None,
                "rain_mm":  (d.get("precipitation_sum", [])[i] or 0.0) if i < len(d.get("precipitation_sum", [])) else 0.0,
            })
        return out

    arch_days = _parse(r_arch.json())
    fcst_days = _parse(r_fcst.json())

    # Aggregate arch_days by calendar month
    monthly_agg: dict[str, dict] = {}
    for d in arch_days:
        ym = d["date"][:7]   # "YYYY-MM"
        if ym not in monthly_agg:
            monthly_agg[ym] = {"max_temps": [], "min_temps": [], "rain_mm": 0.0, "days": 0}
        if d["temp_max"] is not None:
            monthly_agg[ym]["max_temps"].append(d["temp_max"])
        if d["temp_min"] is not None:
            monthly_agg[ym]["min_temps"].append(d["temp_min"])
        monthly_agg[ym]["rain_mm"] += d["rain_mm"]
        monthly_agg[ym]["days"] += 1

    monthly_summary = []
    for ym, agg in sorted(monthly_agg.items()):
        monthly_summary.append({
            "month":          ym,
            "avg_max_temp":   round(sum(agg["max_temps"]) / len(agg["max_temps"]), 1) if agg["max_temps"] else None,
            "avg_min_temp":   round(sum(agg["min_temps"]) / len(agg["min_temps"]), 1) if agg["min_temps"] else None,
            "total_rain_mm":  round(agg["rain_mm"], 1),
            "days_recorded":  agg["days"],
        })

    # 16-day forecast summary
    fcst_rain  = round(sum(d["rain_mm"] for d in fcst_days), 1)
    fcst_temps = [d["temp_max"] for d in fcst_days if d["temp_max"] is not None]
    fcst_avg_max = round(sum(fcst_temps) / len(fcst_temps), 1) if fcst_temps else None

    # Seasonal rainfall total (last 90 days)
    total_rain_90d = round(sum(d["rain_mm"] for d in arch_days), 1)

    # Simple suitability rating: compare actual rain vs expected seasonal norm
    seasonal_norms = {"Kharif": 600, "Rabi": 80, "Zaid": 40}   # mm over 90-day period
    expected = seasonal_norms.get(season, 100)
    rain_pct  = round(total_rain_90d / expected * 100) if expected else 100
    if rain_pct >= 90:
        rainfall_status = "Normal"
    elif rain_pct >= 60:
        rainfall_status = "Below Normal"
    else:
        rainfall_status = "Deficient"

    return {
        "view":    "seasonal",
        "season":  season,
        "meta":    meta,
        "monthly_trend":     monthly_summary,
        "forecast_16d": {
            "total_rain_mm":  fcst_rain,
            "avg_max_temp":   fcst_avg_max,
            "days":           len(fcst_days),
        },
        "seasonal_summary": {
            "total_rain_90d_mm":  total_rain_90d,
            "expected_rain_mm":   expected,
            "rainfall_pct":       rain_pct,
            "rainfall_status":    rainfall_status,
        },
        "data_sources": {
            "archive":  f"Open-Meteo Archive — past 90 days ({arch_start} to {arch_end})",
            "forecast": f"Open-Meteo Forecast — next 16 days",
            "cost":     "Free, no API key required",
        },
    }


# asyncio is needed for gather()

