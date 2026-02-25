"""
Feature Flags - Single Source of Truth for Provider Selection

This file is intentionally duplicated here so the backend works when deployed
to Render (where the repo root IS the backend directory, so the parent-level
flags.py isn't available).

Local dev: main.py adds both parent dir and this dir to sys.path, so the
parent-level flags.py is found first (whichever you edit is used).
Production (Render): this copy is used.
"""

# Active configuration: Pinecone (cloud) + Gemini API
USE_CHROMADB = False
USE_PINECONE = True
USE_LOCAL_MODEL = False
USE_GEMINI_API = True

# UI Configuration
USE_OLD_UI = True
USE_NEW_UI = False


def validate_flags():
    errors = []
    if sum([USE_CHROMADB, USE_PINECONE]) != 1:
        errors.append("Exactly one vector DB must be enabled.")
    if sum([USE_GEMINI_API, USE_LOCAL_MODEL]) != 1:
        errors.append("Exactly one LLM provider must be enabled.")
    if sum([USE_OLD_UI, USE_NEW_UI]) != 1:
        errors.append("Exactly one UI version must be enabled.")
    if errors:
        raise RuntimeError("Invalid flag configuration:\n" + "\n".join(f"  - {e}" for e in errors))
    return True


def get_provider_info():
    return {
        "vector_db":          "ChromaDB" if USE_CHROMADB else "Pinecone",
        "llm":                "Gemini API" if USE_GEMINI_API else "Local Model",
        "ui":                 "Old UI" if USE_OLD_UI else "New UI",
        "requires_internet":  USE_PINECONE or USE_GEMINI_API,
    }


try:
    validate_flags()
    info = get_provider_info()
    print(f"[flags] Vector DB: {info['vector_db']}  |  LLM: {info['llm']}  |  Internet: {info['requires_internet']}")
except ValueError as e:
    print(f"[flags] ERROR: {e}")
    raise
