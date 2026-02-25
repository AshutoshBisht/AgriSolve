# AgriSolve – Farming Planner: Agentic Architecture Plan

**Date:** February 25, 2026  
**Status:** Approved for implementation (pending user go-ahead)

---

## ✅ Final Decisions (Locked In)

| Decision | Choice |
|---|---|
| LLM | Gemini 2.5 Flash (key already in `.env`) |
| Map | Leaflet.js + OpenStreetMap (no key required) |
| UI Entry | New top-level `/farming-planner` page |
| Mandi Data | data.gov.in Agmarknet API (user will get key) |

---

## 1. High-Level Architecture

```
User Browser
     │
     ▼
[Next.js Frontend – /farming-planner]
     │
     ├── Map Agent UI  (Leaflet + Nominatim)
     ├── Crop Selection UI
     ├── Weather & Risk UI
     ├── Market Advisor UI
     ├── Crop Calendar UI
     ├── Crop Doctor UI (chat-style, RAG)
     └── Predictive Analysis UI
          │
          ▼
[FastAPI Backend – /api/planner/...]
          │
          ├── /api/planner/geocode         → Nominatim (OSM, free)
          ├── /api/planner/weather         → Open-Meteo (free, no key)
          ├── /api/planner/crops           → Rule engine + Gemini explanation
          ├── /api/planner/market          → Agmarknet API (data.gov.in)
          ├── /api/planner/calendar        → Static dataset + date logic
          ├── /api/planner/doctor          → RAG (Pinecone) + Gemini
          └── /api/planner/predict         → Rule-based yield model
```

**Session context** (no login): stored in browser `sessionStorage` as:
```json
{
  "lat": 28.65,
  "lon": 77.22,
  "state": "Uttar Pradesh",
  "district": "Agra",
  "land_size": 5,
  "soil_type": "Loamy",
  "selected_crop": "Wheat"
}
```

---

## 2. UI Layout – `/farming-planner`

### 2a. Page Shell

```
┌─────────────────────────────────────────────────────────────┐
│  AgriSolve  [🗺 Map]  [🌾 Crops]  [🌧 Weather]  [📈 Market] │
│             [📅 Calendar]  [🌿 Doctor]  [🔮 Predict]        │
├─────────────────────────────┬───────────────────────────────┤
│                             │                               │
│   LEFT PANEL (40%)          │   RIGHT PANEL (60%)           │
│   ─ Input form              │   ─ Interactive Map           │
│   ─ Agent output cards      │     (Leaflet, OSM tiles)      │
│                             │                               │
└─────────────────────────────┴───────────────────────────────┘
```

**Top nav tabs** switch the left panel content; the map stays persistent on the right and updates markers/overlays per agent.

### 2b. Map Panel (always visible right 60%)
- Leaflet.js map centered on India by default
- On location detect: fly to farmer's district
- Markers:
  - 📍 Farm location
  - 🌧 Weather station pin (nearest)
  - 🏪 Nearest mandi (when market tab active)
- Layers toggle: Satellite / Street / Soil zones (future)

---

## 3. Agent-by-Agent Plan

---

### 3.1 🗺 MAP AGENT

**Route:** `/api/planner/geocode`  
**Method:** GET `?district=Agra&state=Uttar Pradesh`  
**Data source:** Nominatim (OpenStreetMap) – `https://nominatim.openstreetmap.org/search`  

**Frontend form fields:**
- Farmer Name (optional, stored in session)
- State (searchable dropdown – static list of 36 states/UTs)
- District (filtered dropdown based on state)
- Land Size (acres, number input)
- Soil Type (dropdown: Loamy / Sandy / Clay / Black / Red / Alluvial)

**API call chain:**
1. User submits form
2. POST to `/api/planner/geocode` → calls Nominatim → returns `{lat, lon, display_name}`
3. Frontend stores in `sessionStorage`
4. Leaflet map flies to coordinates, drops pin

**Output stored in session:**
```json
{ "lat": 27.18, "lon": 78.02, "state": "Uttar Pradesh", "district": "Agra", "land_size": 5, "soil_type": "Loamy" }
```

**New env var needed:** None (Nominatim is free, no key)

---

### 3.2 🌾 CROP SELECTION AGENT

**Route:** `/api/planner/crops`  
**Method:** POST `{ lat, lon, state, district, soil_type, land_size }`

**Data pipeline:**
1. Fetch current weather from Open-Meteo (`lat, lon`) → temperature, rainfall last 30d
2. Determine season:
   - Kharif: June–October
   - Rabi: November–March
   - Zaid: March–June
3. Run rule engine (see table below)
4. Call Gemini 2.5 Flash to write 2-sentence "Why this crop?" explanation per recommendation

**Rule Engine (crop_rules.py):**

| Soil | Season | Min Temp | Max Temp | Min Rain (mm/mo) | Crops |
|---|---|---|---|---|---|
| Loamy | Kharif | 25 | 35 | 100 | Rice, Maize, Sugarcane |
| Loamy | Rabi | 10 | 25 | 20 | Wheat, Mustard, Barley |
| Black | Kharif | 25 | 38 | 80 | Soybean, Cotton, Sorghum |
| Sandy | Rabi | 8 | 22 | 10 | Mustard, Chickpea, Moong |
| Clay | Kharif | 22 | 32 | 120 | Rice, Jute, Taro |
| Alluvial | Rabi | 10 | 25 | 15 | Wheat, Potato, Peas |
| Red | Kharif | 24 | 36 | 70 | Groundnut, Ragi, Maize |
| (any) | Zaid | 28 | 42 | 0 | Watermelon, Cucumber, Moong |

**Risk score formula:**
```
base_score = 70
if rainfall < crop_min_rain: base_score -= 20  → Drought risk
if temp > crop_max_temp + 3: base_score -= 15  → Heat risk
if rainfall > crop_min_rain * 3: base_score -= 10 → Flood risk
if crop_season matches current_season: base_score += 15
```
- 80–100: Low risk  
- 55–79: Medium risk  
- <55: High risk

**Response shape:**
```json
{
  "season": "Rabi",
  "top_crops": [
    { "name": "Wheat", "risk": "Low", "score": 88, "water_req": "450mm", "yield_range": "2.5–4 t/ha", "why": "..." },
    { "name": "Mustard", "risk": "Low", "score": 82, "water_req": "250mm", "yield_range": "1–1.5 t/ha", "why": "..." },
    { "name": "Barley", "risk": "Medium", "score": 70, "water_req": "350mm", "yield_range": "2–3 t/ha", "why": "..." }
  ]
}
```

**New env var needed:** None (Open-Meteo = free, no key)

---

### 3.3 🌧 WEATHER & RISK AGENT

**Route:** `/api/planner/weather`  
**Method:** GET `?lat=27.18&lon=78.02`

**APIs:**
- **Open-Meteo forecast:** `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=16`
- **Open-Meteo historical (30d):** `https://archive-api.open-meteo.com/v1/archive?...&start_date=...&end_date=...`

**Risk logic:**
| Risk | Condition |
|---|---|
| 🧊 Frost Risk | Min temp forecast < 4°C |
| 🔥 Heat Risk | Max temp > 40°C for 3+ days |
| 🌊 Flood Risk | Precipitation > 50mm in single day |
| 🏜 Drought Risk | < 5mm rain over 14 days |

**Map overlay:** draw a color heat strip on the map timeline (future enhancement — skip for MVP)

**Response shape:**
```json
{
  "current": { "temp": 22, "rain_today": 0, "humidity": 55 },
  "forecast_7d": [...],
  "forecast_16d_summary": { "avg_temp": 21, "total_rain": 12 },
  "risks": [{ "type": "Drought", "level": "Medium", "reason": "Only 5mm rain expected in 14 days" }]
}
```

**New env var needed:** None

---

### 3.4 📈 MARKET ADVISOR AGENT

**Route:** `/api/planner/market`  
**Method:** POST `{ state, district, crop }`

**APIs:**
- **Agmarknet (data.gov.in):**  
  `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`  
  `?api-key={KEY}&format=json&filters[State]={state}&filters[Commodity]={crop}`
- **MSP Fallback:** Static dict of current season MSP values (hardcoded, updated annually)

**Logic:**
```
avg_30d_price = mean(last 30 records)
current_price = latest record

if current_price >= avg_30d_price * 1.05:
    advice = "Sell Now – price is 5%+ above 30-day average"
elif current_price <= avg_30d_price * 0.95:
    advice = "Store – price below average, likely to recover"
else:
    advice = "Wait 2 weeks – market is stable, monitor daily"

if current_price < MSP[crop]:
    advice += " ⚠️ Price below MSP – consider government procurement (APMC)"
```

**Map update:** drop mandi markers on map (nearest 3 mandis by name → geocode via Nominatim)

**Response shape:**
```json
{
  "crop": "Wheat",
  "msp": 2275,
  "current_price": 2400,
  "avg_30d": 2280,
  "trend": "Rising",
  "advice": "Sell Now",
  "nearest_mandis": [{ "name": "Agra Mandi", "price": 2400, "distance_km": 12 }]
}
```

**New env var needed:** `DATA_GOV_API_KEY` (user will register at data.gov.in)

---

### 3.5 📅 CROP CALENDAR AGENT

**Route:** `/api/planner/calendar`  
**Method:** POST `{ state, district, crop, land_size }`

**Data source:** Static crop calendar dataset (`crop_calendar.json`) — one-time file we create.

**Logic:**
1. Look up crop entry in dataset
2. Adjust dates by agro-climatic zone (NW plains / Deccan / NE / Southern)
3. Offset from today's date or from monsoon start date

**Output format:**
```json
{
  "crop": "Wheat",
  "events": [
    { "date": "2025-11-01", "label": "Sowing", "description": "Apply basal fertilizer (DAP 40 kg/acre)", "type": "sow" },
    { "date": "2025-11-21", "label": "1st Irrigation", "type": "irrigation" },
    { "date": "2025-12-15", "label": "1st Fertilizer (Urea top dressing)", "type": "fertilizer" },
    { "date": "2026-01-10", "label": "2nd Irrigation", "type": "irrigation" },
    { "date": "2026-03-20", "label": "Harvest Window Opens", "type": "harvest" }
  ]
}
```

**UI:** Render as a horizontal timeline / month-grid calendar component (no external lib needed — pure CSS grid)

**New env var needed:** None

---

### 3.6 🌿 CROP DOCTOR AGENT

**Route:** `/api/planner/doctor`  
**Method:** POST `{ symptom, crop (optional), district, state }`

**Pipeline:**
1. Embed symptom text using `all-MiniLM-L6-v2` (already loaded)
2. Query Pinecone for top-3 matching chunks from ICAR/FAO documents
3. Build prompt: symptom + retrieved context + farmer location
4. Send to Gemini 2.5 Flash
5. Return structured response

**Prompt template:**
```
You are AgriSolve Crop Doctor. A farmer in {district}, {state} reports: "{symptom}".

Context from agricultural knowledge base:
{rag_context}

Respond with:
1. Most likely disease/deficiency name
2. Cause (1 sentence)
3. Treatment steps (numbered list, max 4 steps)
4. Recommended product/fertilizer (generic names only)
5. Prevention tip (1 sentence)

Keep language simple. Farmer may not be technically trained.
```

**UI:** Chat-style input box in the left panel. Responses appear as structured cards (not raw text).

**Documents to pre-load into Pinecone (namespace: `crop-doctor`):**
- ICAR Package of Practices (key crops)
- FAO IPM guidelines
- State agriculture dept advisories

**New env var needed:** None (reuses existing Pinecone + Gemini keys)

---

### 3.7 🔮 PREDICTIVE ANALYSIS AGENT

**Route:** `/api/planner/predict`  
**Method:** POST `{ state, district, crop, land_size, soil_type }`

**Model (rule-based, no ML training needed):**
```python
base_yield_t_ha = DISTRICT_AVG_YIELD.get((state, crop), NATIONAL_AVG_YIELD[crop])

weather_factor = 1.0
if drought_risk == "High": weather_factor = 0.75
elif drought_risk == "Medium": weather_factor = 0.90
elif heat_risk == "High": weather_factor = 0.85

soil_factor = SOIL_YIELD_FACTOR[soil_type]  # Loamy=1.1, Alluvial=1.1, Black=1.0, Clay=0.95, Sandy=0.85, Red=0.90

predicted_yield = base_yield_t_ha * weather_factor * soil_factor * land_size_ha
estimated_revenue = predicted_yield * current_market_price
```

**Static data files we'll create:**
- `district_avg_yield.json` — major crops × major districts
- `national_avg_yield.json` — fallback
- `soil_yield_factor.json`

**Response shape:**
```json
{
  "crop": "Wheat",
  "land_size_acres": 5,
  "predicted_yield_tons": 8.4,
  "estimated_revenue_inr": 201600,
  "risk_factors": ["Medium drought risk", "Normal temperature"],
  "confidence": "Medium"
}
```

**New env var needed:** None

---

## 4. New Environment Variables

Add to `backend/.env`:
```
# Farming Planner
DATA_GOV_API_KEY=          # from data.gov.in (Agmarknet)
```

That's it — all other APIs are keyless.

---

## 5. New NPM Packages (Frontend)

```
leaflet                  # map rendering
react-leaflet            # React wrapper for Leaflet
@types/leaflet           # TypeScript types
```

---

## 6. New Python Packages (Backend)

```
httpx                    # already installed (URL caching)
# No new packages needed — Open-Meteo and Nominatim are plain HTTP
```

---

## 7. File Structure to Create

### Backend
```
backend/
  planner/
    __init__.py
    router.py            # FastAPI router, mounts all /api/planner/* routes
    map_agent.py         # Nominatim geocoding
    crop_agent.py        # Rule engine + Gemini explanation
    weather_agent.py     # Open-Meteo calls + risk logic
    market_agent.py      # Agmarknet + MSP fallback
    calendar_agent.py    # Static dataset calendar builder
    doctor_agent.py      # RAG + Gemini
    predict_agent.py     # Yield model
    data/
      crop_rules.json
      crop_calendar.json
      district_avg_yield.json
      national_avg_yield.json
      soil_yield_factor.json
      msps.json          # Latest MSP table
```

### Frontend
```
frontend/src/app/farming-planner/
  page.tsx               # Shell: left panel + right map layout
  layout.tsx             # (optional) shared layout
  components/
    MapPanel.tsx         # Leaflet map, always visible
    LocationForm.tsx     # State/district/soil form
    CropCards.tsx        # Top-3 crop recommendation cards
    WeatherWidget.tsx    # 7-day weather + risk badges
    MarketAdvisor.tsx    # Price card + advice
    CropCalendar.tsx     # Timeline/grid calendar
    CropDoctor.tsx       # Chat-style doctor
    PredictWidget.tsx    # Yield + revenue card
    AgentNav.tsx         # Top tab bar switching left panel
```

---

## 8. MVP Build Order (Phase 1 → Phase 2)

### Phase 1 (Core – build first)
1. ✅ Location form + Nominatim geocoding
2. ✅ Leaflet map with farm pin
3. ✅ Open-Meteo weather fetch
4. ✅ Crop selection rule engine
5. ✅ Crop calendar (static)
6. ✅ Crop Doctor (RAG + Gemini)

### Phase 2 (Add after Phase 1 works)
7. Market Advisor (needs data.gov.in key)
8. Predictive Analysis
9. Mandi markers on map
10. Risk overlays on map

---

## 9. API Keys Checklist

| Key | Source | Env Var | Status |
|---|---|---|---|
| Gemini 2.5 Flash | Google AI Studio | `GOOGLE_API_KEY` | ✅ Already in .env |
| Pinecone | pinecone.io | `PINECONE_API_KEY` | ✅ Already in .env |
| Agmarknet | data.gov.in | `DATA_GOV_API_KEY` | ⏳ User to register |
| OpenStreetMap/Nominatim | None | — | ✅ Free, no key |
| Open-Meteo | None | — | ✅ Free, no key |
| Leaflet.js | npm | — | ✅ Free, no key |

---

## 10. What We Are NOT Building (MVP)

- ❌ Image-based disease detection
- ❌ Satellite imagery overlays  
- ❌ Real-time SMS/push alerts
- ❌ User accounts / login
- ❌ ML model training
- ❌ Multi-language support (Phase 3)

---

## ✅ Ready to Implement

**Give the go-ahead and we will:**
1. Create `backend/planner/` with all agent files
2. Mount the router in `main.py`
3. Create `frontend/src/app/farming-planner/` with all components
4. Add `DATA_GOV_API_KEY` placeholder to `.env`
5. Install `react-leaflet` + `leaflet`
