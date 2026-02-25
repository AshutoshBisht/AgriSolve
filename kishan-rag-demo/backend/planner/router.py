# planner/router.py
# ─────────────────────────────────────────────────────────────────────────────
# FARMING PLANNER ROUTER
# Mounts all 7 agent endpoints under the /api/planner prefix.
# Each endpoint is thin: it validates input, calls the relevant agent,
# and returns a JSON response.
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
import httpx

from .map_agent     import geocode_location
from .weather_agent import get_weather
from .crop_agent    import recommend_crops
from .market_agent  import get_market_data
from .calendar_agent import get_calendar
from .doctor_agent  import diagnose
from .predict_agent import predict

router = APIRouter(prefix="/api/planner", tags=["Farming Planner"])

# India geographic center — used as default for India-general mode
INDIA_LAT = 20.5937
INDIA_LON = 78.9629


# ─────────────────────────────────────────────────────────────────────────────
# REQUEST / RESPONSE MODELS
# ─────────────────────────────────────────────────────────────────────────────

class LocationBase(BaseModel):
    """Common fields shared across agents that need a farmer's location."""
    state:      str    = Field(default="", example="Uttar Pradesh")
    district:   str    = Field(default="", example="Agra")
    soil_type:  Optional[str] = Field(default="Loamy",
                                      description="Loamy | Sandy | Clay | Black | Red | Alluvial")
    land_size:  Optional[float] = Field(default=1.0, description="Farm size in acres")
    lat:        Optional[float] = None
    lon:        Optional[float] = None


class CropRequest(LocationBase):
    pass


class MarketRequest(BaseModel):
    state:    str = Field(default="", example="Uttar Pradesh")
    district: str = Field(default="", example="Agra")
    crop:     str = Field(..., example="Wheat")


class CalendarRequest(BaseModel):
    state:    str = Field(default="", example="Uttar Pradesh")
    district: str = Field(default="", example="Agra")
    crop:     str = Field(..., example="Wheat")


class DoctorRequest(BaseModel):
    symptom:  str = Field(..., example="Leaves turning yellow with brown edges")
    crop:     Optional[str] = Field(default="", example="Wheat")
    district: Optional[str] = Field(default="")
    state:    Optional[str] = Field(default="")


class PredictRequest(LocationBase):
    crop: str = Field(..., example="Wheat")


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Geocode ────────────────────────────────────────────────────────────────
@router.get("/geocode")
async def api_geocode(
    district: str = Query(..., example="Agra"),
    state:    str = Query(..., example="Uttar Pradesh"),
):
    """Convert district + state to lat/lon using Nominatim (OpenStreetMap)."""
    return await geocode_location(district=district, state=state)


# ── 1b. Soil Auto-Detection ───────────────────────────────────────────────────
# WRB class → Indian soil type mapping
_WRB_TO_INDIAN = {
    "Vertisols":    "Black",
    "Fluvisols":    "Alluvial",
    "Gleysols":     "Alluvial",
    "Cambisols":    "Loamy",
    "Regosols":     "Sandy",
    "Arenosols":    "Sandy",
    "Calcisols":    "Sandy",
    "Gypsisols":    "Sandy",
    "Acrisols":     "Red",
    "Ferralsols":   "Red",
    "Lixisols":     "Red",
    "Nitisols":     "Red",
    "Luvisols":     "Loamy",
    "Phaeozems":    "Loamy",
    "Chernozems":   "Loamy",
    "Kastanozems":  "Loamy",
    "Solonetz":     "Clay",
    "Planosols":    "Clay",
    "Stagnosols":   "Clay",
    "Histosols":    "Loamy",
    "Andosols":     "Loamy",
    "Umbrisols":    "Loamy",
    "Cryosols":     "Loamy",
    "Durisols":     "Sandy",
    "Solonchaks":   "Sandy",
    "Technosols":   "Loamy",
    "Anthrosols":   "Alluvial",
    "Leptosols":    "Red",
}

@router.get("/soil")
async def api_soil(
    lat: float = Query(..., example=27.18),
    lon: float = Query(..., example=78.02),
):
    """
    Auto-detect soil type from coordinates using SoilGrids (ISRIC) REST API.
    Maps WRB classification to Indian soil categories.
    """
    url = "https://rest.isric.org/soilgrids/v2.0/classification/query"
    params = {"lon": lon, "lat": lat, "number_classes": 1}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        # Response: {"wrb_class_name": "Vertisols", ...}
        wrb_raw = (
            data.get("wrb_class_name")
            or (data.get("most_probable_wrb_class") if isinstance(data, dict) else None)
            or ""
        )
        # SoilGrids v2 returns list of hits
        if not wrb_raw and "hits" in data:
            hits = data["hits"].get("hits", [])
            if hits:
                wrb_raw = hits[0].get("_source", {}).get("wrb_class_name", "") or ""

        # Match any WRB key that appears in the response string
        indian_type = "Loamy"  # default
        for wrb_key, indian in _WRB_TO_INDIAN.items():
            if wrb_key.lower() in (wrb_raw or "").lower():
                indian_type = indian
                break

        return {
            "soil_type":       indian_type,
            "wrb_class":       wrb_raw or "Unknown",
            "source":          "SoilGrids v2.0 (ISRIC)",
            "confidence_note": "WRB → Indian soil classification is approximate",
        }
    except Exception as exc:
        # Never hard-fail — return a default with the error reason
        return {
            "soil_type":       "Loamy",
            "wrb_class":       "Unknown",
            "source":          "Default (SoilGrids unavailable)",
            "error":           str(exc),
        }


# ── 2. Weather ────────────────────────────────────────────────────────────────
@router.get("/weather")
async def api_weather(
    lat:  float = Query(default=INDIA_LAT, example=27.18),
    lon:  float = Query(default=INDIA_LON, example=78.02),
    view: str   = Query(default="weekly",  description="weekly | monthly | seasonal"),
):
    """
    Fetch weather data for a location.
    view: weekly (7-day daily), monthly (4-week summary), seasonal (Kharif/Rabi/Zaid overview)
    Defaults to India geographic center when no coordinates supplied.
    """
    return await get_weather(lat=lat, lon=lon, view=view)


# ── 3. Crop Recommendations ───────────────────────────────────────────────────
@router.post("/crops")
async def api_crops(req: CropRequest):
    """
    Recommend top crops for the farmer's location and current season.
    When no state/district is given, uses India center coordinates (general mode).
    """
    # Resolve coordinates
    if req.lat is not None and req.lon is not None:
        lat, lon = req.lat, req.lon
    elif req.state and req.district:
        geo = await geocode_location(district=req.district, state=req.state)
        lat, lon = geo["lat"], geo["lon"]
    else:
        lat, lon = INDIA_LAT, INDIA_LON   # India general mode

    weather = await get_weather(lat=lat, lon=lon, view="weekly")
    return recommend_crops(
        district=req.district or "India",
        state=req.state or "India",
        soil_type=req.soil_type or "Loamy",
        weather=weather,
    )


# ── 4. Market Advisor ─────────────────────────────────────────────────────────
@router.post("/market")
async def api_market(req: MarketRequest):
    """
    Fetch live mandi prices or MSP fallback.
    When no state/district given, returns national MSP data.
    """
    return await get_market_data(
        state=req.state or "",
        district=req.district or "",
        crop=req.crop,
    )


# ── 5. Crop Calendar ─────────────────────────────────────────────────────────
@router.post("/calendar")
async def api_calendar(req: CalendarRequest):
    """
    Generate a sowing-to-harvest event calendar.
    Falls back to NW Plains zone when no state is given.
    """
    return get_calendar(
        state=req.state or "",
        district=req.district or "",
        crop=req.crop,
    )


# ── 6. Crop Doctor ────────────────────────────────────────────────────────────
@router.post("/doctor")
async def api_doctor(req: DoctorRequest):
    """
    Diagnose a plant health problem using RAG + Gemini.
    Location is optional — returns general diagnosis without it.
    """
    return await diagnose(
        symptom=req.symptom,
        crop=req.crop or "",
        district=req.district or "",
        state=req.state or "",
    )


# ── 7. Predictive Analysis ────────────────────────────────────────────────────
@router.post("/predict")
async def api_predict(req: PredictRequest):
    """
    Predict crop yield and estimated revenue.
    When no state/district given, uses India-average data.
    """
    if req.lat is not None and req.lon is not None:
        lat, lon = req.lat, req.lon
    elif req.state and req.district:
        geo = await geocode_location(district=req.district, state=req.state)
        lat, lon = geo["lat"], geo["lon"]
    else:
        lat, lon = INDIA_LAT, INDIA_LON   # India general mode

    weather = await get_weather(lat=lat, lon=lon, view="weekly")
    return predict(
        state=req.state or "India",
        district=req.district or "India",
        crop=req.crop,
        land_size_acres=req.land_size or 1.0,
        soil_type=req.soil_type or "Loamy",
        weather=weather,
    )


# ── Health check ──────────────────────────────────────────────────────────────
@router.get("/health")
async def planner_health():
    """Quick ping to confirm the planner router is live."""
    return {"status": "ok", "module": "farming-planner"}

