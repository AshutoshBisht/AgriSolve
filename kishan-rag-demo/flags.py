"""
Feature Flags - Single Source of Truth for Provider Selection

This file controls which providers are used for:
- Vector Database (ChromaDB or Pinecone)
- LLM (Gemini API or Local Model)
- UI (Old UI or New UI)

To switch providers, edit the flags below. Only ONE flag per category should be True.

Internet Usage:
- API-based providers (Pinecone, Gemini) require internet
- Local providers (ChromaDB, Local Model) work offline
"""


# Offline mode (local) — removed, not needed
# USE_CHROMADB = True  
# USE_PINECONE = False
# USE_LOCAL_MODEL = True
# USE_GEMINI_API = False

# Active configuration: Pinecone (cloud) + Gemini API
USE_CHROMADB = False
USE_PINECONE = True
USE_LOCAL_MODEL = False  # Local model support removed
USE_GEMINI_API = True

# UI Configuration - Only ONE should be True
USE_OLD_UI = True  # Current UI with chat, voice, and language selection
USE_NEW_UI = False  # New UI design (to be provided) 


def validate_flags():
    """
    Validate that exactly one provider is selected for each category.
    Raises RuntimeError if configuration is invalid (for strict isolation).
    """
    errors = []
    
    # Validate Vector DB selection - STRICT: exactly one
    vector_db_count = sum([USE_CHROMADB, USE_PINECONE])
    if vector_db_count != 1:
        errors.append(
            f"Exactly one vector DB provider must be enabled. "
            f"Currently: USE_CHROMADB={USE_CHROMADB}, USE_PINECONE={USE_PINECONE}"
        )
    
    # Validate LLM selection - STRICT: exactly one
    llm_count = sum([USE_GEMINI_API, USE_LOCAL_MODEL])
    if llm_count != 1:
        errors.append(
            f"Exactly one LLM provider must be enabled. "
            f"Currently: USE_GEMINI_API={USE_GEMINI_API}, USE_LOCAL_MODEL={USE_LOCAL_MODEL}"
        )
    
    # Validate UI selection - STRICT: exactly one
    ui_count = sum([USE_OLD_UI, USE_NEW_UI])
    if ui_count != 1:
        errors.append(
            f"Exactly one UI version must be enabled. "
            f"Currently: USE_OLD_UI={USE_OLD_UI}, USE_NEW_UI={USE_NEW_UI}"
        )
    
    # Validate mode combinations - ensure proper isolation
    if USE_PINECONE and USE_CHROMADB:
        errors.append("Cannot use both Pinecone and ChromaDB. Choose only one vector DB.")
    
    if USE_GEMINI_API and USE_LOCAL_MODEL:
        errors.append("Cannot use both Gemini API and Local Model. Choose only one LLM provider.")
    
    # Validate mode pairs (recommended combinations)
    if USE_PINECONE and USE_LOCAL_MODEL:
        print("[flags] WARNING: Using Pinecone with Local Model (unusual combination)")
    
    if USE_CHROMADB and USE_GEMINI_API:
        print("[flags] WARNING: Using ChromaDB with Gemini API (unusual combination)")
    
    if errors:
        error_msg = "Invalid flag configuration:\n" + "\n".join(f"  - {e}" for e in errors)
        raise RuntimeError(error_msg)
    
    return True


def get_provider_info():
    """
    Returns a summary of selected providers for logging.
    """
    vector_db = "ChromaDB" if USE_CHROMADB else "Pinecone"
    llm = "Gemini API" if USE_GEMINI_API else "Local Model"
    ui = "Old UI" if USE_OLD_UI else "New UI"
    
    requires_internet = USE_PINECONE or USE_GEMINI_API
    
    return {
        "vector_db": vector_db,
        "llm": llm,
        "ui": ui,
        "requires_internet": requires_internet
    }


# Auto-validate on import
try:
    validate_flags()
    info = get_provider_info()
    print(f"[flags] Configuration validated:")
    print(f"  Vector DB: {info['vector_db']}")
    print(f"  LLM: {info['llm']}")
    print(f"  UI: {info['ui']}")
    print(f"  Internet Required: {info['requires_internet']}")
except ValueError as e:
    print(f"[flags] ERROR: {e}")
    raise

