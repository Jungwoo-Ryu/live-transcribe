"""Local JSONL speech worker. The desktop app owns this process and its stdin.
Model weights may download on first warmup. Audio is never uploaded by this code.
"""
import base64
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
ALLOWED_MODELS = {"tiny", "base", "small", "medium", "large-v3", "turbo"}
models = {}


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def get_model(name, allow_download=False):
    if name not in ALLOWED_MODELS:
        raise ValueError("Choose a supported Whisper model.")
    if name not in models:
        emit({"event": "speech-status", "message": f"Preparing {name}; model weights may download." if allow_download else f"Loading cached {name} locally."})
        from faster_whisper import WhisperModel
        models.clear()  # one model in memory
        models[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 4),
                                   local_files_only=not allow_download)
        emit({"event": "speech-status", "message": f"{name} is ready on CPU."})
    return models[name]


def handle(request):
    action = request.get("action", "transcribe")
    if action == "ping":
        from importlib.metadata import version
        return {"version": version("faster-whisper")}
    model = get_model(request.get("model", "base"), request.get("allow_download") is True)
    if action == "warmup":
        return {"ready": True}
    language = request.get("language")
    if language not in {None, "auto", "en", "ko", "zh", "ja", "es", "fr", "de"}:
        raise ValueError("Unsupported language.")
    if language == "auto":
        language = None
    if action == "file":
        source = request["path"]  # path chosen by native file dialog
    elif action == "transcribe":
        import numpy as np
        raw = base64.b64decode(request["pcm"], validate=True)
        if len(raw) > 16000 * 2 * 65 or len(raw) % 2:
            raise ValueError("Invalid or oversized PCM chunk.")
        source = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if source.size < 1600:
            return {"segments": [], "language": language or "auto"}
    else:
        raise ValueError("Unknown speech action.")
    segments, info = model.transcribe(source, language=language, beam_size=1, vad_filter=True,
                                      condition_on_previous_text=False)
    result = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            result.append({"start": segment.start, "end": segment.end, "text": text})
            if action == "file" and len(result) % 25 == 0:
                emit({"event": "speech-status", "message": f"Imported audio: {int(segment.end)} seconds transcribed…"})
    return {"segments": result, "language": info.language}


if __name__ == "__main__":
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 4_000_000:
                raise ValueError("Request is too large.")
            request = json.loads(line)
            emit({"id": request["id"], "result": handle(request)})
        except Exception as error:
            emit({"id": request.get("id"), "error": str(error)[:1000]})
