# planner/doctor_agent.py
# ─────────────────────────────────────────────────────────────────────────────
# CROP DOCTOR AGENT
# Text-based plant disease / deficiency diagnosis.
# Pipeline:
#   1. Embed the farmer's symptom description using the same all-MiniLM-L6-v2
#      model that is already loaded in pinecone_service.py.
#   2. Query Pinecone for the top-3 most relevant knowledge chunks
#      (namespace: "crop-doctor").  These may come from ICAR PDFs, FAO docs,
#      or any document uploaded through the Analyze page.
#   3. Send symptom + retrieved context + location to Gemini 2.5 Flash.
#   4. Return a structured diagnosis card.
# ─────────────────────────────────────────────────────────────────────────────

import os
import sys
from fastapi import HTTPException
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Re-use the already-initialised Pinecone index from pinecone_service.
# We add backend/ to sys.path so this works when the planner module is
# imported from inside the backend/ directory tree.
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from pinecone_service import model as embed_model, get_or_create_index

# ── Pinecone query helper ─────────────────────────────────────────────────────

def _query_knowledge_base(symptom: str, top_k: int = 3) -> tuple[str, list[dict]]:
    """
    Embed the symptom text and query Pinecone for top-k matching chunks.
    Returns (context_string, list of source dicts with doc name + score).
    Falls back to ("", []) if Pinecone is unavailable.
    """
    try:
        index = get_or_create_index()
        vector = embed_model.encode(symptom).tolist()

        results = index.query(
            vector=vector,
            top_k=top_k,
            include_metadata=True,
        )

        chunks   = []
        sources  = []
        for match in results.get("matches", []):
            meta  = match.get("metadata", {})
            text  = meta.get("text", "")
            score = round(match.get("score", 0), 3)
            if text:
                chunks.append(text)
                sources.append({
                    "document":  meta.get("source", meta.get("filename", "Uploaded document")),
                    "chunk_id":  match.get("id", ""),
                    "relevance_score": score,
                    "preview":   text[:120].replace("\n", " ") + ("…" if len(text) > 120 else ""),
                })
        return "\n\n---\n\n".join(chunks), sources
    except Exception:
        return "", []


# ── Gemini diagnosis ──────────────────────────────────────────────────────────

_DOCTOR_PROMPT_TEMPLATE = """You are AgriSolve Crop Doctor, an expert agricultural consultant for Indian farmers.

Farmer location: {district}, {state}
Crop (if mentioned): {crop}
Farmer's description: "{symptom}"

Knowledge base context:
{context}

Diagnose the problem and respond in this EXACT format (no extra text, no markdown headers):

DISEASE: [Name of most likely disease or deficiency]
CAUSE: [One sentence explaining the root cause]
TREATMENT:
1. [First step]
2. [Second step]
3. [Third step]
PRODUCT: [Generic fertilizer/pesticide name — no brand names]
PREVENTION: [One actionable prevention tip for next season]

Keep all language simple. The farmer may not be technically trained."""


async def diagnose(
    symptom: str,
    crop:    str = "",
    district: str = "",
    state:   str = "",
) -> dict:
    """
    Diagnose a crop health problem from a farmer's text description.

    Args:
        symptom:  farmer's description, e.g. "leaves turning yellow with black spots"
        crop:     crop name (optional, helps Gemini narrow the diagnosis)
        district: farmer's district
        state:    farmer's state

    Returns:
        {
            "disease": str,
            "cause": str,
            "treatment": list[str],
            "product": str,
            "prevention": str,
            "context_used": bool   ← True if RAG context found
        }
    """
    if not symptom.strip():
        raise HTTPException(status_code=400, detail="Symptom description cannot be empty.")

    # ── RAG retrieval ──
    context, rag_sources = _query_knowledge_base(symptom)
    context_used = bool(context)

    if not context:
        context = "No specific knowledge base context found. Use general agricultural knowledge."

    # ── Gemini call ──
    prompt = _DOCTOR_PROMPT_TEMPLATE.format(
        district=district or "India",
        state=state or "India",
        crop=crop or "Unknown crop",
        symptom=symptom,
        context=context,
    )

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        raw = response.text.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini error: {e}")

    # ── Parse structured response ──
    parsed = _parse_diagnosis(raw)
    parsed["context_used"] = context_used
    parsed["rag_sources"]  = rag_sources   # list of {document, chunk_id, relevance_score, preview}
    parsed["sources"] = {
        "knowledge_base": "Pinecone vector DB — documents uploaded via Analyze page (all-MiniLM-L6-v2 embeddings)",
        "rag_model":      "sentence-transformers/all-MiniLM-L6-v2 — semantic similarity search",
        "diagnosis_ai":   "Gemini 2.0 Flash (Google AI) — structured diagnosis from symptom + RAG context",
        "prompt_format":  "Structured output: DISEASE / CAUSE / TREATMENT / PRODUCT / PREVENTION",
    }
    return parsed


def _parse_diagnosis(text: str) -> dict:
    """
    Parse Gemini's formatted response into a structured dict.
    Falls back gracefully if the format is not perfectly followed.
    """
    result = {
        "disease":    "",
        "cause":      "",
        "treatment":  [],
        "product":    "",
        "prevention": "",
        "raw":        text,
    }

    lines = text.splitlines()
    current_section = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.startswith("DISEASE:"):
            result["disease"] = line.replace("DISEASE:", "").strip()
        elif line.startswith("CAUSE:"):
            result["cause"] = line.replace("CAUSE:", "").strip()
        elif line.startswith("TREATMENT:"):
            current_section = "treatment"
        elif line.startswith("PRODUCT:"):
            result["product"] = line.replace("PRODUCT:", "").strip()
            current_section = None
        elif line.startswith("PREVENTION:"):
            result["prevention"] = line.replace("PREVENTION:", "").strip()
            current_section = None
        elif current_section == "treatment" and line[0].isdigit():
            # Strip leading numbering like "1. " or "1) "
            step = line.split(".", 1)[-1].split(")", 1)[-1].strip()
            result["treatment"].append(step)

    return result
