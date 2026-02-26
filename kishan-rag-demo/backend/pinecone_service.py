
import os
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter
import hashlib
from datetime import datetime, timezone
from fastapi.concurrency import run_in_threadpool

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENVIRONMENT = os.getenv("PINECONE_ENVIRONMENT", "aws-us-east-1")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "agrisolve")

# Parse PINECONE_ENVIRONMENT (e.g. "aws-us-east-1") into cloud and region
# for ServerlessSpec. Split on the first hyphen only.
_env_parts = PINECONE_ENVIRONMENT.split("-", 1)
cloud  = _env_parts[0] if len(_env_parts) >= 2 else "aws"
region = _env_parts[1] if len(_env_parts) >= 2 else "us-east-1"

pc = Pinecone(api_key=PINECONE_API_KEY)



# Embedding model: 384-dim, ~90MB RAM (lightweight, deployment-friendly)
# NOTE: If you had a previous 1024-dim Pinecone index, delete it first —
#       dimensions must match. The index will be auto-recreated at 384-dim.
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
INDEX_DIM = 384
model = SentenceTransformer(EMBED_MODEL_NAME)
try:
    print(f"[pinecone_service] Embedding model: {EMBED_MODEL_NAME}, dim={model.get_sentence_embedding_dimension()}")
except Exception:
    pass
# Cross-encoder re-ranker removed — not needed with MiniLM's fast cosine similarity

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)


def get_or_create_index():
    index_names = pc.list_indexes().names()
    if PINECONE_INDEX_NAME not in index_names:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=INDEX_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud=cloud, region=region)
        )
    return pc.Index(PINECONE_INDEX_NAME)

index = get_or_create_index()


async def upsert_document(text, metadata=None, batch_size=50, chunk_offset=0):
    # Accept doc_name and doc_url in metadata
    doc_name = metadata.get("doc_name") if metadata else None
    doc_url = metadata.get("doc_url") if metadata else None
    chunks = text_splitter.split_text(text)
    total_chunks = len(chunks)
    for batch_start in range(0, total_chunks, batch_size):
        batch_chunks = chunks[batch_start:batch_start+batch_size]
        embeddings = await run_in_threadpool(model.encode, batch_chunks)
        embeddings = embeddings.tolist()
        ids = [f"chunk-{chunk_offset + batch_start + i}" for i in range(len(batch_chunks))]
        to_upsert = []
        for i, (chunk, emb) in enumerate(zip(batch_chunks, embeddings)):
            chunk_metadata = {
                "text": chunk,
                "chunk_index": chunk_offset + batch_start + i
            }
            if doc_name:
                chunk_metadata["doc_name"] = doc_name
            if doc_url:
                chunk_metadata["doc_url"] = doc_url
            to_upsert.append((ids[i], emb, chunk_metadata))
        index.upsert(vectors=to_upsert)
    return total_chunks


async def query_index(query, top_k=3, return_metadata=False):
    query_emb = await run_in_threadpool(model.encode, [query])
    query_emb = query_emb[0].tolist()
    res = index.query(vector=query_emb, top_k=top_k, include_metadata=True)
    matches = res['matches']
    if not matches:
        return []
    if return_metadata:
        return matches
    return [m['metadata']['text'] for m in matches]


def _url_sentinel_id(url: str) -> str:
    """Generate a stable Pinecone vector ID for a URL sentinel."""
    return "sentinel-" + hashlib.sha256(url.strip().lower().encode()).hexdigest()[:32]


async def check_url_cache(url: str) -> dict:
    """
    Check if this URL has already been indexed.
    Returns: {"cached": True/False, "content_hash": str|None, "indexed_at": str|None}
    """
    sentinel_id = _url_sentinel_id(url)
    try:
        result = index.fetch(ids=[sentinel_id])
        vectors = result.get("vectors", {})
        if sentinel_id in vectors:
            meta = vectors[sentinel_id].get("metadata", {})
            return {
                "cached": True,
                "content_hash": meta.get("content_hash"),
                "indexed_at": meta.get("indexed_at"),
                "doc_name": meta.get("doc_name"),
            }
    except Exception as e:
        print(f"[pinecone_service] cache check error: {e}")
    return {"cached": False, "content_hash": None, "indexed_at": None}


async def store_url_sentinel(url: str, content_hash: str, doc_name: str = ""):
    """
    Store a sentinel vector for a URL so we can detect if it's already indexed
    and whether its content has changed.
    """
    sentinel_id = _url_sentinel_id(url)
    # Use the embedding of the URL itself as the vector
    emb = await run_in_threadpool(model.encode, [url])
    emb = emb[0].tolist()
    index.upsert(vectors=[(
        sentinel_id,
        emb,
        {
            "type": "sentinel",
            "doc_url": url,
            "doc_name": doc_name,
            "content_hash": content_hash,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }
    )])
    print(f"[pinecone_service] Sentinel stored for URL: {url[:60]}...")
