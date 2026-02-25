"""
Audio transcription via Groq Whisper API.

Why Groq instead of local Whisper:
- Local whisper-small needs ~1GB RAM and crashes Render free tier (512MB)
- Groq runs whisper-large-v3-turbo in the cloud — better quality, zero RAM cost
- No torch / transformers / librosa / ffmpeg required
- Free tier: 7,200 seconds of audio / hour

Setup: add GROQ_API_KEY to your .env
Get a free key at: https://console.groq.com
"""

import os
import tempfile
from groq import Groq
from fastapi import UploadFile

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
_client = None

# Whisper language codes supported by Groq
LANGUAGE_MAP = {
    "hi": "hi", "hindi": "hi",
    "mr": "mr", "marathi": "mr",
    "en": "en", "english": "en",
}


def get_client() -> Groq:
    global _client
    if _client is None:
        if not GROQ_API_KEY:
            raise RuntimeError(
                "GROQ_API_KEY is not set. "
                "Get a free key at https://console.groq.com and add it to your .env"
            )
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


async def transcribe_audio(audio_file: UploadFile, language: str = None) -> dict:
    """
    Transcribe audio using Groq whisper-large-v3-turbo API.

    Supported formats: webm, mp3, wav, m4a, ogg, flac, mp4, mpeg
    Max file size: 25MB
    No ffmpeg or local model needed - Groq handles decoding server-side.

    Args:
        audio_file: FastAPI UploadFile (any common audio format)
        language:   Optional code - "en", "hi", "mr" (or None for auto-detect)

    Returns:
        dict with "text" and "language"
    """
    content = await audio_file.read()
    if not content:
        raise ValueError("Uploaded audio file is empty (0 bytes)")

    filename = audio_file.filename or "audio.webm"
    suffix = os.path.splitext(filename)[1].lower() or ".webm"
    lang_code = LANGUAGE_MAP.get((language or "").lower(), None)

    print(f"[audio_service] Groq transcribe | {filename} | {len(content)/1024:.1f}KB | lang={lang_code or 'auto'}")

    client = get_client()
    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, mode="wb") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        with open(tmp_path, "rb") as f:
            kwargs: dict = {
                "file": (filename, f),
                "model": "whisper-large-v3-turbo",
                "response_format": "json",
            }
            if lang_code:
                kwargs["language"] = lang_code

            result = client.audio.transcriptions.create(**kwargs)

        text = (result.text or "").strip()
        if not text:
            raise ValueError(
                "Transcription returned empty text - "
                "audio may be silent, too short, or unsupported format."
            )

        print(f"[audio_service] OK | '{text[:80]}{'...' if len(text) > 80 else ''}'")
        return {"text": text, "language": lang_code or "auto"}

    except Exception as e:
        print(f"[audio_service] ERROR: {type(e).__name__}: {e}")
        raise Exception(f"Transcription failed: {e}")

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass