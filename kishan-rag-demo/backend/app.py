from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
import os
import sys
import fitz  # pymupdf
import tempfile

# Import feature flags from root directory
_backend_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_backend_dir)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
import flags

# ============================================================================
# VECTOR DATABASE INITIALIZATION (Based on flags)
# ============================================================================
VECTOR_DB_AVAILABLE = False
upsert_document = None
query_index = None

if flags.USE_PINECONE:
    try:
        from pinecone_service import upsert_document, query_index
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
from audio_service import transcribe_audio
import google.generativeai as genai
# Import centralized language service
from language_service import process_user_input, format_response_for_user, get_model_with_fallback

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

# Lazy load local SLM for fallback
_local_tokenizer = None
_local_model = None
LOCAL_MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"  # Small 1.1B model
MODELS_DIR = "./models"
LOCAL_LLM_PATH = os.path.join(MODELS_DIR, "tinyllama-chat")
USE_LOCAL_LLM = os.path.exists(LOCAL_LLM_PATH)

def get_local_llm():
    """Lazy load local LLM for fallback when API quota exceeded"""
    global _local_tokenizer, _local_model
    if _local_tokenizer is None or _local_model is None:
        from transformers import AutoTokenizer, AutoModelForCausalLM
        import torch
        model_path = LOCAL_LLM_PATH if USE_LOCAL_LLM else LOCAL_MODEL_NAME
        print(f"[main] Loading local LLM from: {model_path}...")
        _local_tokenizer = AutoTokenizer.from_pretrained(model_path)
        _local_model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map="auto"
        )
        print(f"[main] Local LLM loaded successfully")
    return _local_tokenizer, _local_model


# Legacy translate_text function - now uses language_service
# Kept for backward compatibility, but new code should use language_service directly
async def translate_text(text: str, target_language: str) -> str:
    """Legacy wrapper - use language_service.format_response_for_user() instead."""
    from language_service import format_response_for_user
    return await format_response_for_user(text, target_language)


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



@app.delete("/api/clear-chromadb")
async def clear_chromadb_endpoint():
    """
    Clear all documents from ChromaDB collection.
    
    This endpoint deletes all stored embeddings and documents from ChromaDB.
    Useful for resetting the database without deleting the entire directory.
    """
    if not flags.USE_CHROMADB:
        return JSONResponse(
            status_code=400,
            content={"error": "ChromaDB is not enabled. This endpoint only works with ChromaDB mode."}
        )
    
    if not VECTOR_DB_AVAILABLE:
        return JSONResponse(
            status_code=503,
            content={"error": "ChromaDB is not available. Please check your ChromaDB installation."}
        )
    
    try:
        import chroma_service
        if hasattr(chroma_service, 'clear_collection'):
            result = chroma_service.clear_collection()
            return JSONResponse(content=result)
        else:
            return JSONResponse(
                status_code=500,
                content={"error": "Clear collection function not available"}
            )
    except Exception as e:
        import traceback
        print(f"[main] Clear ChromaDB error: {e}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.post("/api/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    language: str = Form(None)
):
    """
    Transcribe audio to text
    
    Args:
        audio: Audio file (wav, mp3, m4a, etc.)
        language: Optional language code (hi, en, mr) for forced language detection
    
    Returns:
        JSON with 'text' and 'language' fields
    """
    try:
        result = await transcribe_audio(audio, language)
        return JSONResponse(content={
            "text": result["text"],
            "language": result["language"],
            "success": True
        })
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[main] Transcription endpoint error: {e}")
        print(f"[main] Traceback: {error_trace}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "success": False}
        )


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Multilingual Chat Endpoint
    
    LANGUAGE PROCESSING PIPELINE:
    ==============================
    
    1. INPUT NORMALIZATION (User Language → English)
       - User input: Native script (Hindi/Marathi) OR Hinglish ("computer kya hai")
       - Normalize to meaningful English: "What is a computer?"
       - This happens internally - user sees their original input
    
    2. VECTOR SEARCH (English)
       - Use normalized English query for embeddings/retrieval
       - Ensures better semantic matching
    
    3. LLM PROCESSING (English)
       - Generate response in English
       - Both Pinecone+API and ChromaDB+Local modes process in English
    
    4. OUTPUT TRANSLATION (English → User Language)
       - Translate response back to user's selected language
       - User sees ONLY their selected language
    
    USER EXPERIENCE:
    - User types in selected language (native or Hinglish)
    - User sees their original input in chat
    - User receives response in selected language
    - User NEVER sees English unless English is selected
    
    Supports:
    - Native script input (Hindi: "कंप्यूटर क्या है?")
    - Hinglish/phonetic input ("computer kya hai")
    - Both Pinecone + API and ChromaDB + Local Model modes
    """
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
        # ====================================================================
        # LANGUAGE PROCESSING PIPELINE
        # ====================================================================
        # Step 1: Normalize user input to English for internal processing
        # - Handles native script (Hindi/Marathi) → English
        # - Handles Hinglish/phonetic ("computer kya hai") → "What is a computer?"
        # - User's original input is preserved in frontend (not modified here)
        user_language = request.language or "en"
        
        print(f"[chat] User input (language={user_language}): {request.question[:100]}...")
        
        # Normalize to English for processing (handles both native script and Hinglish)
        question_for_processing = await process_user_input(request.question, user_language)
        
        print(f"[chat] Normalized to English for processing: {question_for_processing[:100]}...")
        
        # Step 2: Vector search using English query (for better retrieval)
        matches = await query_index(question_for_processing, top_k=5, return_metadata=True)
        context = "\n".join([m["metadata"]["text"] for m in matches])

        # Format chat history for prompt (history is in user's language, but LLM can handle it)
        history_str = ""
        if request.history:
            for msg in request.history:
                role = "User" if msg.sender == "user" else "Bot"
                history_str += f"{role}: {msg.text}\n"
        if history_str:
            history_str = f"--- CHAT HISTORY ---\n{history_str}\n"

        # Build prompt using English question for LLM processing
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
            f"--- QUESTION ---\n{question_for_processing}\n\n"
            "--- ANSWER (in Markdown) ---"
        )
        sources = [m["metadata"] for m in matches]
        
        # ====================================================================
        # MODE 1: PINECONE + GEMINI API (Fast, Streaming - with fallback)
        # ====================================================================
        if flags.USE_PINECONE and flags.USE_GEMINI_API:
            if not GOOGLE_API_KEY:
                def fallback_stream():
                    yield "[LLM not configured] Retrieved context: " + context
                    yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                return StreamingResponse(fallback_stream(), media_type="text/plain")

            # Step 3: Generate English response from LLM
            # Step 4: Translate response to user's language (ALWAYS, unless English)
            needs_translation = user_language and user_language.lower() not in ["en", "english", None]
            
            try:
                # Try text generation models with fallback (gemini-2.5-flash -> gemini-2.5-flash-lite -> gemini-3-flash -> Gemma models)
                if needs_translation:
                    # Get full response first, then translate to user's language
                    response = get_model_with_fallback(prompt, stream=False)
                    english_response = response.text if response.text else "[No response generated]"
                    
                    # Translate to user's language
                    translated_response = await format_response_for_user(english_response, user_language)
                    
                    def stream_generator():
                        yield translated_response
                        yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                    return StreamingResponse(stream_generator(), media_type="text/plain")
                else:
                    # English selected - stream directly
                    def stream_generator():
                        try:
                            response_stream = get_model_with_fallback(prompt, stream=True)
                            for chunk in response_stream:
                                if hasattr(chunk, 'text') and chunk.text:
                                    yield chunk.text
                        except Exception as stream_error:
                            # If streaming fails, try non-streaming
                            print(f"[chat] Streaming failed: {stream_error}, trying non-streaming...")
                            try:
                                response = get_model_with_fallback(prompt, stream=False)
                                if response.text:
                                    yield response.text
                            except Exception:
                                # Will be caught by outer try-catch and fallback to local model
                                raise
                        # At the end, send a marker and the sources as JSON
                        yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                    return StreamingResponse(stream_generator(), media_type="text/plain")
            
            except Exception as gemini_error:
                # All Gemini models failed (quota exhausted) - fallback to local model
                error_msg = str(gemini_error).lower()
                is_quota_error = ("quota" in error_msg or "resource_exhausted" in error_msg or "429" in error_msg)
                
                print(f"[chat] All Gemini models failed: {gemini_error}")
                if is_quota_error:
                    print("[chat] Quota exhausted for all Gemini models, falling back to local model...")
                else:
                    print("[chat] Gemini API error, falling back to local model...")
                
                # Fallback to local model
                try:
                    from fastapi.concurrency import run_in_threadpool
                    import asyncio
                    
                    tokenizer, model = get_local_llm()
                    
                    # Format prompt for TinyLlama chat format (using English question)
                    chat_prompt = f"<|system|>\n{prompt}</s>\n<|user|>\n{question_for_processing}</s>\n<|assistant|>\n"
                    
                    # Get device from model's first parameter (handles device_map="auto" case)
                    try:
                        device = next(model.parameters()).device
                    except (StopIteration, AttributeError):
                        device = "cpu"
                    inputs = tokenizer(chat_prompt, return_tensors="pt", truncation=True, max_length=1024).to(device)
                    input_length = inputs.input_ids.shape[1]
                    
                    def _generate():
                        import torch
                        with torch.no_grad():
                            outputs = model.generate(
                                inputs.input_ids,
                                attention_mask=inputs.attention_mask if hasattr(inputs, 'attention_mask') else None,
                                max_new_tokens=128,
                                min_new_tokens=5,
                                temperature=0.7,
                                do_sample=True,
                                top_p=0.9,
                                top_k=50,
                                repetition_penalty=1.1,
                                pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id,
                                eos_token_id=tokenizer.eos_token_id,
                                use_cache=True
                            )
                            new_tokens = outputs[0][input_length:]
                            return tokenizer.decode(new_tokens, skip_special_tokens=True)
                    
                    try:
                        response_text = await asyncio.wait_for(
                            run_in_threadpool(_generate),
                            timeout=120.0
                        )
                    except asyncio.TimeoutError:
                        response_text = "I apologize, but the response is taking longer than expected. Please try again with a shorter question."
                    
                    if "<|assistant|>" in response_text:
                        response_text = response_text.split("<|assistant|>")[-1].strip()
                    
                    response_text = response_text.replace("<|system|>", "").replace("<|user|>", "").replace("</s>", "").strip()
                    
                    if not response_text or len(response_text) < 5:
                        response_text = "I understand your question, but I'm having trouble generating a detailed response. Could you please rephrase your question?"
                    
                    # Step 4: Translate response to user's language (if needed)
                    # Note: Translation also uses Gemini API, so if quota is exhausted, skip translation
                    if needs_translation:
                        try:
                            response_text = await format_response_for_user(response_text, user_language)
                            print(f"[chat] Translated local model response to {user_language}")
                        except Exception as trans_error:
                            print(f"[chat] Translation failed (quota likely exhausted): {trans_error}, user will see English response")
                            # Continue with English response if translation fails
                    
                    def stream_generator():
                        yield response_text
                        yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
                    
                    return StreamingResponse(stream_generator(), media_type="text/plain")
                
                except Exception as local_error:
                    # Even local model failed - return error
                    print(f"[chat] Local model fallback also failed: {local_error}")
                    return JSONResponse(
                        status_code=500,
                        content={"error": f"All models failed. Gemini error: {str(gemini_error)}, Local model error: {str(local_error)}"}
                    )
        
        # ====================================================================
        # MODE 2: CHROMADB + LOCAL MODEL (Offline - No Internet Required)
        # ====================================================================
        elif flags.USE_CHROMADB and flags.USE_LOCAL_MODEL:
            # Use local LLM directly (no API calls, fully offline)
            from fastapi.concurrency import run_in_threadpool
            import asyncio
            
            tokenizer, model = get_local_llm()
            
            # Format prompt for TinyLlama chat format (using English question)
            chat_prompt = f"<|system|>\n{prompt}</s>\n<|user|>\n{question_for_processing}</s>\n<|assistant|>\n"
            
            inputs = tokenizer(chat_prompt, return_tensors="pt", truncation=True, max_length=1024).to(model.device)
            input_length = inputs.input_ids.shape[1]
            
            def _generate():
                import torch
                with torch.no_grad():
                    outputs = model.generate(
                        inputs.input_ids,
                        attention_mask=inputs.attention_mask if hasattr(inputs, 'attention_mask') else None,
                        max_new_tokens=128,
                        min_new_tokens=5,
                        temperature=0.7,
                        do_sample=True,
                        top_p=0.9,
                        top_k=50,
                        repetition_penalty=1.1,
                        pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id,
                        eos_token_id=tokenizer.eos_token_id,
                        use_cache=True
                    )
                    new_tokens = outputs[0][input_length:]
                    return tokenizer.decode(new_tokens, skip_special_tokens=True)
            
            try:
                response_text = await asyncio.wait_for(
                    run_in_threadpool(_generate),
                    timeout=120.0
                )
            except asyncio.TimeoutError:
                response_text = "I apologize, but the response is taking longer than expected. Please try again with a shorter question."
            
            if "<|assistant|>" in response_text:
                response_text = response_text.split("<|assistant|>")[-1].strip()
            
            response_text = response_text.replace("<|system|>", "").replace("<|user|>", "").replace("</s>", "").strip()
            
            if not response_text or len(response_text) < 5:
                response_text = "I understand your question, but I'm having trouble generating a detailed response. Could you please rephrase your question?"
            
            # Step 4: Translate response to user's language (ALWAYS, unless English)
            # Note: Translation requires Google API key (Gemini API)
            # If translation fails, user will see English (fallback)
            needs_translation = user_language and user_language.lower() not in ["en", "english", None]
            if needs_translation:
                try:
                    response_text = await format_response_for_user(response_text, user_language)
                    print(f"[chat] Translated response to {user_language}")
                except Exception as e:
                    print(f"[chat] Translation failed in ChromaDB mode: {e}, user will see English response")
                    # Continue with English response if translation fails
            
            def stream_generator():
                yield response_text
                yield "\n[[SOURCES]]" + JSONResponse(content={"sources": sources}).body.decode()
            
            return StreamingResponse(stream_generator(), media_type="text/plain")
        
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
