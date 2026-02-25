# planner/market_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# MARKET ADVISOR AGENT
# Fetches live mandi prices from the Agmarknet API (data.gov.in).
# Falls back to static MSP table if the API key is not configured or the
# commodity is not found in the API response.
# Generates a simple buy/sell/wait recommendation based on price trend.
# ─────────────────────────────────────────────────────────────────────────────

import os
import json
import httpx
import statistics
from fastapi import HTTPException
from dotenv import load_dotenv

load_dotenv()

_DATA = os.path.join(os.path.dirname(__file__), "data")

# Load static MSP table (Minimum Support Price)
with open(os.path.join(_DATA, "msps.json")) as f:
    _MSP_TABLE: dict = json.load(f)
    _MSP_TABLE.pop("_comment", None)

# Agmarknet API endpoint on data.gov.in
# Resource ID for "Variety-wise Daily Market Prices Data-Agmarknet"
AGMARKNET_URL = (
    "https://api.data.gov.in/resource/"
    "9ef84268-d588-465a-a308-a864a43d0070"
)

DATA_GOV_KEY = os.getenv("DATA_GOV_API_KEY", "")


# ── Fetch live mandi data ─────────────────────────────────────────────────────

async def _fetch_agmarknet(state: str, crop: str) -> list[dict]:
    """
    Fetch last 30 records for a crop in a given state from Agmarknet API.
    Returns a list of price records or an empty list if the API is unavailable.
    """
    if not DATA_GOV_KEY:
        return []   # Key not configured — fall through to MSP fallback

    params = {
        "api-key":              DATA_GOV_KEY,
        "format":               "json",
        "limit":                30,
        "filters[State]":       state,
        "filters[Commodity]":   crop,
    }

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(AGMARKNET_URL, params=params)
            r.raise_for_status()
            data = r.json()
            return data.get("records", [])
    except Exception:
        # Network error or bad key — silently fall back
        return []


# ── Recommendation logic ──────────────────────────────────────────────────────

def _make_advice(current_price: float, avg_30d: float, msp: float) -> str:
    """
    Simple rule-based market advice:
      Sell Now  → current price is ≥5% above 30-day average
      Store     → current price is ≥5% below 30-day average
      Wait      → price is near average

    MSP warning is appended if the price falls below government minimum.
    """
    if current_price >= avg_30d * 1.05:
        advice = "✅ Sell Now — price is above the 30-day average"
    elif current_price <= avg_30d * 0.95:
        advice = "📦 Store — price is below average, likely to recover"
    else:
        advice = "⏳ Wait 2 weeks — market is stable, monitor daily"

    if msp and current_price < msp * 100:   # MSP is per quintal (100 kg), price is per quintal
        advice += " ⚠️ Price is below MSP — consider APMC government procurement"

    return advice


# ── Main function ─────────────────────────────────────────────────────────────

async def get_market_data(state: str, district: str, crop: str) -> dict:
    """
    Return market intelligence for a crop at a farmer's location.

    Returns:
        {
            "crop": str,
            "msp_per_quintal": float | None,
            "current_price_per_quintal": float | None,
            "avg_30d_price": float | None,
            "trend": "Rising" | "Falling" | "Stable",
            "advice": str,
            "data_source": "Agmarknet Live" | "MSP Only (no live data)",
            "nearest_mandis": list[dict]   # up to 3 mandis from API records
        }
    """
    msp: float | None = _MSP_TABLE.get(crop)

    # ── Try live API ──
    records = await _fetch_agmarknet(state, crop)

    if records:
        # Extract modal price (best proxy for actual transaction price)
        prices = []
        mandis_seen = {}
        for rec in records:
            try:
                price = float(rec.get("Modal_Price") or rec.get("modal_price") or 0)
                if price > 0:
                    prices.append(price)
                mandi_name = rec.get("Market") or rec.get("market", "")
                if mandi_name and mandi_name not in mandis_seen and len(mandis_seen) < 3:
                    mandis_seen[mandi_name] = {
                        "name": mandi_name,
                        "district": rec.get("District", district),
                        "price_per_quintal": price,
                    }
            except (ValueError, TypeError):
                continue

        if prices:
            current_price = prices[0]          # most recent record first
            avg_30d       = statistics.mean(prices)

            # Trend: compare first third vs last third of price list
            if len(prices) >= 6:
                first_avg = statistics.mean(prices[-len(prices)//3:])
                last_avg  = statistics.mean(prices[:len(prices)//3])
                trend = "Rising" if last_avg > first_avg * 1.02 else (
                         "Falling" if last_avg < first_avg * 0.98 else "Stable")
            else:
                trend = "Stable"

            advice = _make_advice(current_price, avg_30d, msp or 0)

            # ── Price logic breakdown ──
            pct_vs_avg = round((current_price - avg_30d) / avg_30d * 100, 1) if avg_30d else 0
            pct_vs_msp = round((current_price - (msp * 100)) / (msp * 100) * 100, 1) if msp else None

            price_logic = {
                "current_vs_30d_avg_pct": pct_vs_avg,
                "sell_threshold":  "+5% above 30-day avg → Sell Now",
                "store_threshold": "−5% below 30-day avg → Store & wait",
                "msp_floor":       f"₹{msp}/quintal (Govt. Minimum Support Price)" if msp else "MSP not set for this crop",
                "current_vs_msp_pct": pct_vs_msp,
                "records_analysed": len(prices),
                "advice_reason": (
                    f"Current price ₹{current_price}/q is {abs(pct_vs_avg)}% "
                    f"{'above' if pct_vs_avg >= 0 else 'below'} the 30-day average of ₹{round(avg_30d,2)}/q"
                ),
            }

            return {
                "crop":                      crop,
                "msp_per_quintal":           msp,
                "current_price_per_quintal": round(current_price, 2),
                "avg_30d_price":             round(avg_30d, 2),
                "trend":                     trend,
                "advice":                    advice,
                "data_source":               "Agmarknet Live (data.gov.in)",
                "nearest_mandis":            list(mandis_seen.values()),
                "price_logic":               price_logic,
                "sources": {
                    "live_prices":  "Agmarknet / data.gov.in — Variety-wise Daily Market Prices (resource 9ef84268)",
                    "msp":          "msps.json — Govt. of India MSP notification (Rabi 2025-26 / Kharif 2025)",
                    "trend_method": "Compare avg of newest 1/3 records vs oldest 1/3 (±2% threshold for Rising/Falling)",
                },
            }

    # ── Fallback: MSP only ──
    return {
        "crop":                      crop,
        "msp_per_quintal":           msp,
        "current_price_per_quintal": None,
        "avg_30d_price":             None,
        "trend":                     "Unknown",
        "advice":                    (
            f"Live mandi data unavailable. Government MSP is ₹{msp}/quintal. "
            "Add DATA_GOV_API_KEY to backend/.env for live prices."
            if msp else
            "No price data available for this crop."
        ),
        "data_source":               "MSP Only (no live data)",
        "nearest_mandis":            [],
        "price_logic":               None,
        "sources": {
            "live_prices": "Agmarknet API unavailable — DATA_GOV_API_KEY not set or network error",
            "msp":         "msps.json — Govt. of India MSP notification (Rabi 2025-26 / Kharif 2025)",
        },
    }
