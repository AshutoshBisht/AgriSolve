# planner/autonomous_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# AUTONOMOUS FARMING AGENT — powered by Agno + Gemini Function Calling
#
# Unlike the hardcoded pipeline agents, this agent lets Gemini decide:
#   - Which tools to call
#   - In what order
#   - When it has enough information to answer
#
# Framework: Agno (https://agno.com) — lightweight Python agent library
# Model:     Gemini 2.0 Flash via google-generativeai
# Tools:     5 real official APIs (Open-Meteo, SoilGrids, Data.gov.in, Nominatim)
# ─────────────────────────────────────────────────────────────────────────────

import os
import sys
import httpx
import asyncio
from datetime import date
from dotenv import load_dotenv

load_dotenv()

# Add backend root to path so we can import existing services
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# ── Tool Implementations ──────────────────────────────────────────────────────
# Each function below is a "tool" — Gemini calls these autonomously.
# Functions must be synchronous (Agno runs them in a thread pool internally).
# They return plain dicts which Gemini reads as tool results.

def geocode_location(district: str, state: str) -> dict:
    """
    Convert a district and state name into geographic coordinates (lat/lon).
    Uses OpenStreetMap Nominatim — free, no API key required.

    Args:
        district: Name of the district (e.g. "Agra")
        state: Name of the Indian state (e.g. "Uttar Pradesh")

    Returns:
        dict with lat, lon, display_name
    """
    try:
        url    = "https://nominatim.openstreetmap.org/search"
        params = {
            "q":              f"{district}, {state}, India",
            "format":         "json",
            "limit":          1,
            "addressdetails": 1,
        }
        headers = {"User-Agent": "AgriSolveBot/1.0"}
        response = httpx.get(url, params=params, headers=headers, timeout=10.0)
        response.raise_for_status()
        results = response.json()
        if results:
            r = results[0]
            return {
                "status":       "success",
                "lat":          float(r["lat"]),
                "lon":          float(r["lon"]),
                "display_name": r.get("display_name", f"{district}, {state}"),
            }
        return {"status": "not_found", "lat": 20.5937, "lon": 78.9629,
                "display_name": "India (default center)"}
    except Exception as e:
        return {"status": "error", "error": str(e), "lat": 20.5937, "lon": 78.9629}


def get_weather_for_location(lat: float, lon: float) -> dict:
    """
    Fetch real-time 7-day weather forecast for a farm location.
    Uses Open-Meteo API — official meteorological data, free, no API key.

    Args:
        lat: Latitude of the location
        lon: Longitude of the location

    Returns:
        dict with current conditions, 7-day forecast, and farm risk assessment
    """
    try:
        params = {
            "latitude":      lat,
            "longitude":     lon,
            "daily":         "temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max",
            "forecast_days": 7,
            "timezone":      "Asia/Kolkata",
            "current":       "temperature_2m,relative_humidity_2m,precipitation,windspeed_10m,weathercode",
        }
        response = httpx.get("https://api.open-meteo.com/v1/forecast",
                             params=params, timeout=12.0)
        response.raise_for_status()
        data = response.json()

        current = data.get("current", {})
        daily   = data.get("daily", {})

        # Build 7-day forecast
        forecast = []
        dates     = daily.get("time", [])
        max_temps = daily.get("temperature_2m_max", [])
        min_temps = daily.get("temperature_2m_min", [])
        rain      = daily.get("precipitation_sum", [])
        wind      = daily.get("windspeed_10m_max", [])

        for i, d in enumerate(dates):
            forecast.append({
                "date":       d,
                "temp_max":   max_temps[i] if i < len(max_temps) else None,
                "temp_min":   min_temps[i] if i < len(min_temps) else None,
                "rain_mm":    rain[i] if i < len(rain) else 0.0,
                "wind_kmh":   wind[i] if i < len(wind) else None,
            })

        # Determine season
        month = date.today().month
        if 6 <= month <= 10:
            season = "Kharif (Monsoon)"
        elif month <= 3 or month >= 11:
            season = "Rabi (Winter)"
        else:
            season = "Zaid (Summer)"

        return {
            "status": "success",
            "current_temp_c":      current.get("temperature_2m"),
            "current_humidity_pct": current.get("relative_humidity_2m"),
            "current_rain_mm":     current.get("precipitation"),
            "current_wind_kmh":    current.get("windspeed_10m"),
            "forecast_7d":         forecast,
            "season":              season,
            "data_source":         "Open-Meteo (official meteorological data, free)",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_soil_type(lat: float, lon: float) -> dict:
    """
    Auto-detect soil type from GPS coordinates using ISRIC SoilGrids v2 API.
    Returns standard Indian soil classification (Loamy, Sandy, Clay, Black, Red, Alluvial).

    Args:
        lat: Latitude
        lon: Longitude

    Returns:
        dict with Indian soil type, WRB scientific classification, and farming implications
    """
    WRB_TO_INDIAN = {
        "Vertisols": "Black",  "Fluvisols": "Alluvial", "Gleysols": "Alluvial",
        "Cambisols": "Loamy",  "Regosols": "Sandy",     "Arenosols": "Sandy",
        "Calcisols": "Sandy",  "Acrisols": "Red",        "Ferralsols": "Red",
        "Lixisols":  "Red",    "Nitisols": "Red",        "Luvisols": "Loamy",
        "Phaeozems": "Loamy",  "Chernozems": "Loamy",   "Solonetz": "Clay",
        "Planosols": "Clay",   "Stagnosols": "Clay",     "Anthrosols": "Alluvial",
        "Leptosols": "Red",    "Histosols": "Loamy",     "Andosols": "Loamy",
    }

    SOIL_FARMING_TIPS = {
        "Black":    "Excellent for cotton and soybean. Retains moisture well. Can become waterlogged.",
        "Alluvial": "Highly fertile. Ideal for wheat, rice, sugarcane. Found in river plains.",
        "Loamy":    "Best all-round soil. Suitable for most crops including vegetables and pulses.",
        "Sandy":    "Low water retention. Ideal for groundnut, watermelon, carrot. Needs frequent irrigation.",
        "Clay":     "Heavy, compact soil. Good for rice paddies. Poor drainage — avoid waterlogging.",
        "Red":      "Iron-rich, well-drained. Good for millets, groundnut, potato in Deccan region.",
    }

    try:
        url    = "https://rest.isric.org/soilgrids/v2.0/classification/query"
        params = {"lon": lon, "lat": lat, "number_classes": 1}
        response = httpx.get(url, params=params, timeout=15.0)
        response.raise_for_status()
        data     = response.json()
        wrb_raw  = data.get("wrb_class_name", "") or ""

        indian_type = "Loamy"  # sensible default
        for wrb_key, indian in WRB_TO_INDIAN.items():
            if wrb_key.lower() in (wrb_raw or "").lower():
                indian_type = indian
                break

        return {
            "status":          "success",
            "indian_soil_type": indian_type,
            "wrb_class":        wrb_raw or "Unknown",
            "farming_tip":      SOIL_FARMING_TIPS.get(indian_type, "Suitable for mixed farming."),
            "data_source":      "ISRIC SoilGrids v2.0 (official global soil data)",
        }
    except Exception as e:
        return {
            "status":          "fallback",
            "indian_soil_type": "Loamy",
            "wrb_class":        "Unknown",
            "farming_tip":      "Loamy soil assumed as default — good for most crops.",
            "error":            str(e),
        }


def get_market_price(crop: str, state: str, district: str = "") -> dict:
    """
    Fetch live mandi (wholesale market) prices for a crop from India's official
    Data.gov.in Agmarknet API. Falls back to national MSP (Minimum Support Price)
    if live data is unavailable.

    Args:
        crop: Crop name (e.g. "Wheat", "Rice", "Tomato")
        state: State name (e.g. "Uttar Pradesh")
        district: Optional district name for more local pricing

    Returns:
        dict with current price, price range, and market source
    """
    DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY", "")

    # National MSP fallback data (per quintal, ₹, 2024-25 season)
    MSP_DATA = {
        "wheat": {"price": 2275, "unit": "per quintal", "season": "Rabi 2024-25"},
        "rice":  {"price": 2300, "unit": "per quintal", "season": "Kharif 2024-25"},
        "maize": {"price": 2090, "unit": "per quintal", "season": "Kharif 2024-25"},
        "cotton": {"price": 7121, "unit": "per quintal (medium staple)", "season": "Kharif 2024-25"},
        "soybean": {"price": 4892, "unit": "per quintal", "season": "Kharif 2024-25"},
        "groundnut": {"price": 6783, "unit": "per quintal", "season": "Kharif 2024-25"},
        "mustard": {"price": 5950, "unit": "per quintal", "season": "Rabi 2024-25"},
        "chickpea": {"price": 5440, "unit": "per quintal", "season": "Rabi 2024-25"},
        "lentil": {"price": 6425, "unit": "per quintal", "season": "Rabi 2024-25"},
        "sugarcane": {"price": 340,  "unit": "per quintal (FRP)", "season": "2024-25"},
        "sunflower": {"price": 7280, "unit": "per quintal", "season": "Kharif 2024-25"},
        "jowar":  {"price": 3371, "unit": "per quintal", "season": "Kharif 2024-25"},
        "bajra":  {"price": 2625, "unit": "per quintal", "season": "Kharif 2024-25"},
    }

    crop_lower = crop.lower().strip()

    # Try Data.gov.in Agmarknet live API first
    if DATA_GOV_API_KEY:
        try:
            url    = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"
            params = {
                "api-key": DATA_GOV_API_KEY,
                "format":  "json",
                "limit":   5,
                "filters[Commodity]": crop.title(),
            }
            if state:
                params["filters[State]"] = state
            if district:
                params["filters[District]"] = district
            response = httpx.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data    = response.json()
            records = data.get("records", [])
            if records:
                r = records[0]
                return {
                    "status":      "live",
                    "crop":        crop,
                    "state":       r.get("State", state),
                    "market":      r.get("Market", ""),
                    "min_price":   r.get("Min Price", "N/A"),
                    "max_price":   r.get("Max Price", "N/A"),
                    "modal_price": r.get("Modal Price", "N/A"),
                    "unit":        "per quintal (₹)",
                    "date":        r.get("Arrival Date", ""),
                    "data_source": "Data.gov.in Agmarknet (official Indian mandi prices)",
                }
        except Exception:
            pass  # fall through to MSP

    # Fallback: MSP data
    msp = MSP_DATA.get(crop_lower)
    if msp:
        return {
            "status":      "msp_fallback",
            "crop":        crop,
            "msp_price":   msp["price"],
            "unit":        msp["unit"],
            "price_inr":   f"₹{msp['price']} {msp['unit']}",
            "season":      msp["season"],
            "note":        "MSP (Minimum Support Price) — government guaranteed floor price. Actual mandi price may be higher.",
            "data_source": "CACP / Ministry of Agriculture India (official MSP announcement)",
        }

    return {
        "status":  "not_found",
        "crop":    crop,
        "message": f"No price data available for '{crop}'. Try common crops like Wheat, Rice, Maize, Cotton.",
    }


def get_crop_recommendations(
    district: str,
    state: str,
    soil_type: str,
    season: str,
    avg_temp_c: float,
    monthly_rain_mm: float,
) -> dict:
    """
    Recommend the best crops to grow based on location, soil type, current season,
    and weather conditions. Uses AgriSolve's rule-based crop database.

    Args:
        district: Farmer's district
        state: Farmer's state
        soil_type: Soil type — Loamy, Sandy, Clay, Black, Red, or Alluvial
        season: Current season — Kharif, Rabi, or Zaid
        avg_temp_c: Average temperature in Celsius
        monthly_rain_mm: Estimated monthly rainfall in mm

    Returns:
        dict with top crop recommendations and suitability scores
    """
    import json
    _DATA = os.path.join(os.path.dirname(__file__), "data")
    crop_rules_path = os.path.join(_DATA, "crop_rules.json")

    try:
        with open(crop_rules_path) as f:
            CROP_RULES = json.load(f)
    except Exception:
        return {"status": "error", "error": "Crop rules database not found."}

    def score_crop(rule):
        s = 70
        if season.split()[0] in rule.get("seasons", []):
            s += 15
        if avg_temp_c > rule["max_temp"] + 3:
            s -= 15
        elif avg_temp_c < rule["min_temp"] - 3:
            s -= 10
        min_rain = rule.get("min_rain_mm_month", 0)
        if monthly_rain_mm < min_rain * 0.5:
            s -= 20
        elif monthly_rain_mm < min_rain:
            s -= 10
        elif monthly_rain_mm > min_rain * 3 and min_rain > 0:
            s -= 10
        return max(0, min(100, s))

    scored = []
    for rule in CROP_RULES:
        if soil_type not in rule.get("soils", []):
            continue
        s = score_crop(rule)
        scored.append({
            "crop":        rule["crop"],
            "score":       s,
            "risk":        "Low" if s >= 80 else "Medium" if s >= 60 else "High",
            "water_req":   rule.get("water_req", "Moderate"),
            "yield_range": rule.get("yield_range", "Varies"),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top3 = scored[:3]

    return {
        "status":       "success",
        "district":     district,
        "state":        state,
        "season":       season,
        "soil_type":    soil_type,
        "top_crops":    top3,
        "inputs_used":  {
            "avg_temp_c":       avg_temp_c,
            "monthly_rain_mm":  monthly_rain_mm,
        },
        "data_source":  "AgriSolve crop_rules.json — 18-crop database with soil/temp/rainfall thresholds",
    }


# ── Agno Agent Setup ──────────────────────────────────────────────────────────

def create_farming_agent():
    """
    Create and return an Agno Agent with access to all 5 farming tools.
    Gemini 2.0 Flash decides which tools to call and in what order.
    """
    from agno.agent import Agent
    from agno.models.google import Gemini

    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY not set — required for Agno + Gemini agent")

    agent = Agent(
        name="AgriSolve Farming Advisor",
        model=Gemini(id="gemini-2.0-flash", api_key=GOOGLE_API_KEY),
        tools=[
            geocode_location,
            get_weather_for_location,
            get_soil_type,
            get_market_price,
            get_crop_recommendations,
        ],
        description=(
            "You are AgriSolve, an expert AI agricultural advisor for Indian farmers. "
            "You have access to real-time weather data, official soil maps, live mandi prices, "
            "and a crop recommendation engine. Use your tools to gather the data you need "
            "before giving advice. Always cite which APIs you used. "
            "Give practical, actionable advice in simple language suitable for farmers."
        ),
        instructions=[
            "Always use geocode_location first when a district or state is mentioned.",
            "Use get_weather_for_location to get real conditions before recommending crops.",
            "Use get_soil_type to auto-detect soil when coordinates are available.",
            "Use get_market_price to give farmers pricing context for their crops.",
            "Structure your final answer with: 📍 Location | 🌤️ Weather | 🌱 Recommendations | 💰 Prices.",
            "Keep language simple — the farmer may not be technically trained.",
        ],
        show_tool_calls=True,
        markdown=True,
    )
    return agent


async def run_agent(query: str) -> dict:
    """
    Run the autonomous farming agent on a natural language query.
    Returns the agent's response and the tool calls it made.

    Args:
        query: Farmer's natural language question

    Returns:
        dict with answer text and tool_trace (list of tools called + results)
    """
    agent = create_farming_agent()

    tool_trace = []

    try:
        # Run agent in thread pool since Agno is sync
        loop = asyncio.get_event_loop()

        def _run():
            return agent.run(query, stream=False)

        response = await loop.run_in_executor(None, _run)

        # Extract tool call trace from messages
        for msg in (response.messages or []):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_trace.append({
                        "tool": tc.function.name if hasattr(tc, "function") else str(tc),
                        "arguments": tc.function.arguments if hasattr(tc, "function") else {},
                    })

        answer = response.content if hasattr(response, "content") else str(response)

        return {
            "status":     "success",
            "answer":     answer,
            "tool_trace": tool_trace,
            "query":      query,
        }

    except Exception as e:
        return {
            "status": "error",
            "error":  str(e),
            "query":  query,
        }
