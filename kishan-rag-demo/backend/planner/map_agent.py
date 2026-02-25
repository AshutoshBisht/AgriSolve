# planner/map_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# MAP AGENT
# Converts a state + district string into latitude/longitude coordinates using
# Nominatim (OpenStreetMap's free geocoding API — no API key required).
# The coordinates are then returned to the frontend so Leaflet can center the map.
# ─────────────────────────────────────────────────────────────────────────────

import httpx
from fastapi import HTTPException

# Nominatim requires a descriptive User-Agent string identifying your app.
# Using a generic "python-requests" would get rate-limited/blocked.
NOMINATIM_USER_AGENT = "AgriSolve/1.0 (agrisolve-farming-planner)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


async def geocode_location(district: str, state: str) -> dict:
    """
    Geocode a district + state in India to lat/lon using Nominatim.

    Args:
        district: e.g. "Agra"
        state: e.g. "Uttar Pradesh"

    Returns:
        {
            "lat": float,
            "lon": float,
            "display_name": str   # human-readable full address from OSM
        }

    Raises:
        HTTPException 404 if Nominatim can't find the location.
        HTTPException 502 if the Nominatim API itself fails.
    """
    query = f"{district}, {state}, India"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                NOMINATIM_URL,
                params={
                    "q": query,
                    "format": "json",
                    "limit": 1,
                    "countrycodes": "in",   # restrict results to India
                    "addressdetails": 1,
                },
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
            response.raise_for_status()
            results = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Geocoding service error: {exc}")

    if not results:
        raise HTTPException(
            status_code=404,
            detail=f"Could not find location: {district}, {state}. "
                   "Check spelling or try a nearby city name.",
        )

    best = results[0]
    return {
        "lat": float(best["lat"]),
        "lon": float(best["lon"]),
        "display_name": best.get("display_name", query),
    }
