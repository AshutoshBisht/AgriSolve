from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
import os
import sys
import fitz  # pymupdf
import tempfile
import hashlib
import httpx
from bs4 import BeautifulSoup

# Import feature flags.
# Local dev:  flags.py lives one level up (kishan-rag-demo/flags.py)
# Production: flags.py is a copy inside this backend/ directory
# Both paths are added so whichever is found first is used.
_backend_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_backend_dir)
for _p in (_project_root, _backend_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import flags
from language_service import get_model_with_fallback

# ============================================================================
# VECTOR DATABASE INITIALIZATION (Based on flags)
# ============================================================================
VECTOR_DB_AVAILABLE = False
upsert_document = None
query_index = None

if flags.USE_PINECONE:
    try:
        from pinecone_service import upsert_document, query_index, check_url_cache, store_url_sentinel
        VECTOR_DB_AVAILABLE = True
        print("[main] Using Pinecone for vector storage (cloud-based)")
    except Exception as e:
        print(f"[main] ERROR: Pinecone not available: {e}")
        VECTOR_DB_AVAILABLE = False

elif flags.USE_CHROMADB:
    try:
        import chroma_service
        if chroma_service.CHROMA_AVAILABLE and chroma_service.client is not None and chroma_service.collection is not None:
            from chroma_service import upsert_document, query_index
            VECTOR_DB_AVAILABLE = True
            print("[main] Using ChromaDB for vector storage (local, persistent at ./chroma_db)")
        else:
            error_msg = getattr(chroma_service, 'chromadb_error', 'ChromaDB not properly initialized')
            raise ImportError(error_msg)
    except (ImportError, AttributeError) as e:
        error_str = str(e)
        print(f"[main] ERROR: ChromaDB not available: {error_str}")
        if "Python 3.14" in error_str:
            print("[main] ChromaDB requires Python 3.11 or 3.12. Current Python version is incompatible.")
            print("[main] Please use Python 3.11 or 3.12, or install chromadb: pip install chromadb")
        else:
            print("[main] Please install chromadb: pip install chromadb")
        VECTOR_DB_AVAILABLE = False
        # Create dummy functions that raise clear errors
        async def upsert_document(*args, **kwargs):
            if "Python 3.14" in error_str:
                raise Exception("ChromaDB is not compatible with Python 3.14. Please use Python 3.11 or 3.12.")
            raise Exception("ChromaDB is not available. Please install chromadb: pip install chromadb")
        async def query_index(*args, **kwargs):
            if "Python 3.14" in error_str:
                raise Exception("ChromaDB is not compatible with Python 3.14. Please use Python 3.11 or 3.12.")
            raise Exception("ChromaDB is not available. Please install chromadb: pip install chromadb")
# audio_service uses Groq API — no local model, deployment-friendly
from audio_service import transcribe_audio
import google.generativeai as genai
# Local model imports removed — USE_GEMINI_API is always True
# from transformers import AutoTokenizer, AutoModelForCausalLM
# import torch

# ── Farming Planner multi-agent router ──────────────────────────────────────
# All 7 agent endpoints live under /api/planner/*
# Import is guarded so a missing optional dependency never crashes the main app.
try:
    from planner.router import router as planner_router
    _PLANNER_AVAILABLE = True
except Exception as _planner_err:
    _PLANNER_AVAILABLE = False
    print(f"[main] WARNING: Farming Planner router not loaded: {_planner_err}")

app = FastAPI()

# Allow frontend origin from env (set FRONTEND_URL in production, e.g. https://your-app.vercel.app)
_frontend_url = os.getenv("FRONTEND_URL", "")
origins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]
if _frontend_url:
    origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount Farming Planner router ─────────────────────────────────────────────
# Registers all /api/planner/* endpoints (geocode, weather, crops, market,
# calendar, doctor, predict).  Skipped gracefully if the module failed to load.
if _PLANNER_AVAILABLE:
    app.include_router(planner_router)
    print("[main] Farming Planner router mounted at /api/planner/*")


load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

# Local LLM (TinyLlama) removed — not needed when using Gemini API
# _local_tokenizer = None
# _local_model = None
# LOCAL_MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
# MODELS_DIR = "./models"
# LOCAL_LLM_PATH = os.path.join(MODELS_DIR, "tinyllama-chat")
# USE_LOCAL_LLM = os.path.exists(LOCAL_LLM_PATH)
#
# def get_local_llm():
#     global _local_tokenizer, _local_model
#     if _local_tokenizer is None or _local_model is None:
#         model_path = LOCAL_LLM_PATH if USE_LOCAL_LLM else LOCAL_MODEL_NAME
#         _local_tokenizer = AutoTokenizer.from_pretrained(model_path)
#         _local_model = AutoModelForCausalLM.from_pretrained(
#             model_path,
#             torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
#             device_map="auto"
#         )
#     return _local_tokenizer, _local_model


async def translate_text(text: str, target_language: str) -> str:
    """
    Translate English text to target language using Google Gemini API.
    
    Args:
        text: English text to translate
        target_language: Target language code (hi, mr, en)
    
    Returns:
        Translated text (or original if target is English or translation fails)
    """
    # Skip translation if target is English or text is empty
    if target_language in [None, "en", "english"] or not text.strip():
        return text
    
    # Normalize language code
    lang_map = {
        "hi": "Hindi",
        "mr": "Marathi",
        "hindi": "Hindi",
        "marathi": "Marathi"
    }
    target_lang_name = lang_map.get(target_language.lower(), None)
    
    if not target_lang_name:
        print(f"[main] Unknown target language: {target_language}, skipping translation")
        return text
    
    try:
        if not GOOGLE_API_KEY:
            print(f"[main] No Google API key, skipping translation")
            return text
        
        # Use Gemini for translation with fallback
        translation_prompt = f"Translate the following English text to {target_lang_name}. Preserve markdown formatting, code blocks, and special characters. Only return the translated text, nothing else:\n\n{text}"
        
        response = get_model_with_fallback(translation_prompt, stream=False)
        translated = response.text.strip() if response.text else text
        
        print(f"[main] Translated response to {target_lang_name} ({len(translated)} chars)")
        return translated
        
    except Exception as e:
        print(f"[main] Translation failed: {e}, returning original text")
        return text  # Return original on translation failure


from typing import List, Optional

class Message(BaseModel):
    sender: str
    text: str
    sources: Optional[list] = None

class ChatRequest(BaseModel):
    question: str
    history: Optional[List[Message]] = None
    language: Optional[str] = None  # Language code (en, hi, mr) for response translation


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...), doc_url: str = Form(...)):
    if not VECTOR_DB_AVAILABLE:
        if flags.USE_PINECONE:
            return JSONResponse(status_code=503, content={"error": "Pinecone is not available. Please check PINECONE_API_KEY, PINECONE_ENVIRONMENT, and PINECONE_INDEX_NAME in .env"})
        else:
            error_msg = "ChromaDB is not available. "
            try:
                import chroma_service
                if hasattr(chroma_service, 'chromadb_error') and chroma_service.chromadb_error:
                    if "Python 3.14" in chroma_service.chromadb_error:
                        error_msg += "ChromaDB is not compatible with Python 3.14. Please use Python 3.11 or 3.12."
                    else:
                        error_msg += "Please install chromadb: pip install chromadb"
                else:
                    error_msg += "Please install chromadb: pip install chromadb"
            except:
                error_msg += "Please install chromadb: pip install chromadb"
            return JSONResponse(status_code=503, content={"error": error_msg})
    if not file.filename.lower().endswith('.pdf'):
        return JSONResponse(status_code=400, content={"error": "Only PDF files are supported."})

    try:
        # Save uploaded file to a temporary location for pymupdf
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        doc = fitz.open(tmp_path)
        total_chunks = 0
        batch_pages = 20
        num_pages = doc.page_count
        for start in range(0, num_pages, batch_pages):
            end = min(start + batch_pages, num_pages)
            print(f"Processing pages {start+1} to {end} of {num_pages}...")
            text = "\n".join(doc.load_page(i).get_text("text") or "" for i in range(start, end))
            if text.strip():
                print(f"Upserting batch for pages {start+1}-{end}...")
                num = await upsert_document(
                    text,
                    metadata={
                        "doc_name": file.filename,
                        "doc_url": doc_url
                    },
                    chunk_offset=total_chunks
                )
                total_chunks += num
                print(f"Batch upserted: {num} chunks (total so far: {total_chunks})")
        doc.close()
        os.remove(tmp_path)
        storage_info = "Pinecone" if flags.USE_PINECONE else "ChromaDB (stored locally in ./chroma_db)"
        return {"message": f"PDF uploaded and {total_chunks} chunks upserted to {storage_info}."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/upload-url")
async def upload_url(url: str = Form(...)):
    """
    Scrape a URL, hash its content, and index it in Pinecone.
    If the URL was previously indexed with the same content, returns cached result.
    If content has changed, re-indexes the updated content.
    """
    if not VECTOR_DB_AVAILABLE:
        return JSONResponse(status_code=503, content={"error": "Pinecone is not available."})

    url = url.strip()
    if not url.startswith(("http://", "https://")):
        return JSONResponse(status_code=400, content={"error": "Invalid URL. Must start with http:// or https://"})

    try:
        # 1. Scrape the URL
        print(f"[upload-url] Fetching: {url}")
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 AgriSolveBot/1.0"})
            response.raise_for_status()

        # 2. Extract clean text from HTML
        soup = BeautifulSoup(response.text, "html.parser")
        # Remove scripts, styles, nav, footer — keep main content
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        page_title = soup.title.string.strip() if soup.title and soup.title.string else url
        text = soup.get_text(separator="\n", strip=True)

        if len(text) < 100:
            return JSONResponse(status_code=422, content={"error": "Could not extract meaningful text from this URL."})

        # 3. Hash the content
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        print(f"[upload-url] Content hash: {content_hash[:16]}... ({len(text)} chars)")

        # 4. Check cache — is this URL already indexed with the same content?
        cache = await check_url_cache(url)
        if cache["cached"] and cache["content_hash"] == content_hash:
            print(f"[upload-url] Cache HIT — same content, skipping re-index")
            return {
                "message": f"'{page_title}' is already indexed and up to date. No re-indexing needed.",
                "cached": True,
                "indexed_at": cache["indexed_at"],
            }

        # 5. Content is new or changed — upsert into Pinecone
        status = "updated" if cache["cached"] else "new"
        print(f"[upload-url] Cache MISS ({status}) — indexing content...")
        total_chunks = await upsert_document(
            text,
            metadata={"doc_name": page_title, "doc_url": url, "content_hash": content_hash},
        )

        # 6. Store/update the sentinel so future calls hit the cache
        await store_url_sentinel(url, content_hash, doc_name=page_title)

        return {
            "message": f"'{page_title}' indexed successfully ({total_chunks} chunks).",
            "cached": False,
            "status": status,
            "chunks": total_chunks,
        }

    except httpx.HTTPStatusError as e:
        return JSONResponse(status_code=502, content={"error": f"Failed to fetch URL: HTTP {e.response.status_code}"})
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": f"Network error fetching URL: {str(e)}"})
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    language: str = Form(None)
):
    """
    Transcribe audio to text via Groq whisper-large-v3-turbo.
    Supported formats: webm, mp3, wav, m4a, ogg, flac.
    Language: 'en', 'hi', 'mr' or omit for auto-detect.
    """
    try:
        result = await transcribe_audio(audio, language)
        return JSONResponse(content={
            "text": result["text"],
            "language": result["language"],
            "success": True
        })
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "success": False}
        )


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if not VECTOR_DB_AVAILABLE:
        if flags.USE_PINECONE:
            return JSONResponse(status_code=503, content={"error": "Pinecone is not available. Please check PINECONE_API_KEY, PINECONE_ENVIRONMENT, and PINECONE_INDEX_NAME in .env"})
        else:
            error_msg = "ChromaDB is not available. "
            try:
                import chroma_service
                if hasattr(chroma_service, 'chromadb_error') and chroma_service.chromadb_error:
                    if "Python 3.14" in chroma_service.chromadb_error:
                        error_msg += "ChromaDB is not compatible with Python 3.14. Please use Python 3.11 or 3.12."
                    else:
                        error_msg += "Please install chromadb: pip install chromadb"
                else:
                    error_msg += "Please install chromadb: pip install chromadb"
            except:
                error_msg += "Please install chromadb: pip install chromadb"
            return JSONResponse(status_code=503, content={"error": error_msg})
    
    try:
        matches = await query_index(request.question, top_k=5, return_metadata=True)
        context = "\n".join([m["metadata"]["text"] for m in matches])

        # Format chat history for prompt
        history_str = ""
        if request.history:
            for msg in request.history:
                role = "User" if msg.sender == "user" else "Bot"
                history_str += f"{role}: {msg.text}\n"
        if history_str:
            history_str = f"--- CHAT HISTORY ---\n{history_str}\n"

        prompt = (
            "You are AgriSolve, a helpful AI agricultural assistant. "
            "Based *only* on the context provided, answer the user's question. "
            "Format your answer clearly using Markdown for readability. "
            "Use bullet points, bold text, and paragraphs where helpful. "
            "Add an extra blank line after each heading, list, or paragraph for clarity. "
            "Do not make up information. Keep the response size adequate for conversation along with markdown text and heading highlights and lists for visual seperation. "
            "If the user's message is a greeting, acknowledgment, or a very short/unclear query, reply concisely (1-2 sentences) and do not repeat the context or sources.\n\n"
            f"{history_str}"
            f"--- CONTEXT ---\n{context}\n\n"
            f"--- QUESTION ---\n{request.question}\n\n"
            "--- ANSWER (in Markdown) ---"
        )
        sources = [m["metadata"] for m in matches]
        
        # ====================================================================
        # MODE 1: PINECONE + GEMINI API (Fast, Streaming - like backendinitial)
        # ====================================================================
        if flags.USE_PINECONE and flags.USE_GEMINI_API:
            if not GOOGLE_API_KEY:
                def fallback_stream():
                    yield "[LLM not configured] Retrieved context: " + context
                    yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                return StreamingResponse(fallback_stream(), media_type="text/plain")

            # Check if translation is needed
            needs_translation = request.language and request.language.lower() not in ["en", "english", None]
            
            if needs_translation:
                # For translation, we need to get full response first, then translate
                response = get_model_with_fallback(prompt, stream=False)
                full_response = response.text if response.text else "[No response generated]"
                translated_response = await translate_text(full_response, request.language)
                
                def stream_generator():
                    yield translated_response
                    yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                return StreamingResponse(stream_generator(), media_type="text/plain")
            else:
                # No translation needed - use streaming for fast response (like backendinitial)
                def stream_generator():
                    response_stream = get_model_with_fallback(prompt, stream=True)
                    for chunk in response_stream:
                        if chunk.text:
                            yield chunk.text
                    # At the end, send a marker and the sources as JSON
                    yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                return StreamingResponse(stream_generator(), media_type="text/plain")
        
        # MODE 2: CHROMADB + LOCAL MODEL removed — use Gemini API instead
        # elif flags.USE_CHROMADB and flags.USE_LOCAL_MODEL: ...

        else:
            return JSONResponse(
                status_code=500,
                content={"error": "Invalid mode configuration. Check flags.py"}
            )
                
    except Exception as e:
        import traceback
        print(f"Chat endpoint error: {e}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
