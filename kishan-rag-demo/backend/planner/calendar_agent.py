# planner/calendar_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# CROP CALENDAR AGENT
# Generates a sowing-to-harvest event timeline for a given crop.
# Dates are adjusted per agro-climatic zone (NW Plains, Eastern Plains, etc.)
# and expressed as absolute calendar dates for the upcoming season.
# ─────────────────────────────────────────────────────────────────────────────

import json
import os
from datetime import date, timedelta
from fastapi import HTTPException

_DATA = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(_DATA, "crop_calendar.json")) as f:
    _CALENDAR: dict = json.load(f)
    _CALENDAR.pop("_comment", None)

with open(os.path.join(_DATA, "agro_zones.json")) as f:
    _AGRO_ZONES: dict = json.load(f)
    _AGRO_ZONES.pop("_comment", None)

# Event type → icon for the frontend to display
EVENT_ICONS = {
    "sow":          "🌱",
    "irrigation":   "💧",
    "fertilizer":   "🧪",
    "harvest":      "🌾",
}


def _resolve_date(month_day: str, ref_year: int) -> str:
    """
    Convert a 'MM-DD' string to a full 'YYYY-MM-DD' date string.
    If the resolved date is in the past (by >30 days), roll forward 1 year.
    """
    mm, dd = map(int, month_day.split("-"))
    candidate = date(ref_year, mm, dd)
    if (candidate - date.today()).days < -30:
        candidate = date(ref_year + 1, mm, dd)
    return candidate.isoformat()


def get_calendar(state: str, district: str, crop: str) -> dict:
    """
    Build a cultivation calendar for a crop at a farmer's location.

    Args:
        state:   farmer's state
        district: farmer's district
        crop:    selected crop name (must match a key in crop_calendar.json)

    Returns:
        {
            "crop": str,
            "zone": str,
            "events": [
                {
                    "date": "YYYY-MM-DD",
                    "label": str,
                    "description": str,
                    "type": "sow"|"irrigation"|"fertilizer"|"harvest",
                    "icon": str
                },
                ...
            ]
        }

    Raises:
        HTTPException 404 if the crop or zone is not in the database.
    """
    # Look up the crop calendar
    crop_data = _CALENDAR.get(crop)
    if not crop_data:
        raise HTTPException(
            status_code=404,
            detail=f"No calendar data for '{crop}'. "
                   f"Available crops: {list(_CALENDAR.keys())}"
        )

    # Determine agro-climatic zone from state; fall back to "NW Plains"
    zone = _AGRO_ZONES.get(state, "NW Plains")

    # Get zone-specific schedule; fall back to first available zone for the crop
    schedule = crop_data.get(zone) or next(iter(crop_data.values()))

    today     = date.today()
    ref_year  = today.year
    events    = []

    # ── Sowing ──
    sow_date = _resolve_date(schedule["sow"], ref_year)
    events.append({
        "date":        sow_date,
        "label":       "Sowing",
        "description": "Prepare field, apply basal fertilizer, and sow seeds.",
        "type":        "sow",
        "icon":        "🌱",
    })

    # ── Fertilizer events ──
    for fe in schedule.get("fertilizer_events", []):
        events.append({
            "date":        _resolve_date(fe["dap"], ref_year),
            "label":       "Fertilizer",
            "description": fe["label"],
            "type":        "fertilizer",
            "icon":        "🧪",
        })

    # ── Irrigation events ──
    for irr_md in schedule.get("irrigations", []):
        events.append({
            "date":        _resolve_date(irr_md, ref_year),
            "label":       "Irrigation",
            "description": "Apply irrigation water as needed based on soil moisture.",
            "type":        "irrigation",
            "icon":        "💧",
        })

    # ── Harvest window ──
    harvest_start = _resolve_date(schedule["harvest_start"], ref_year)
    harvest_end   = _resolve_date(schedule["harvest_end"],   ref_year)
    events.append({
        "date":        harvest_start,
        "label":       "Harvest Window Opens",
        "description": f"Harvest between {harvest_start} and {harvest_end} when crop is mature.",
        "type":        "harvest",
        "icon":        "🌾",
    })

    # Sort chronologically
    events.sort(key=lambda e: e["date"])

    return {
        "crop":   crop,
        "zone":   zone,
        "events": events,
    }
