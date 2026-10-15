# Validation — OpenAI edition v0.3.0

Environment: Linux x64, Node.js 24.19.0, Python 3.12.14, Electron 44.7.2.

## Current checks

- JavaScript syntax checks pass.
- Eleven core tests pass: session persistence/export/path safety; fragmented UTF-8 SSE; authenticated Responses request and streamed output; failed/abrupt streams; cancellation; missing/invalid API-key errors; missing speech setup; final partial audio flush.
- Request tests verify the official Responses URL, Bearer authentication, `store:false`, stream enabled, reference context and absence of the former local-model request options.
- Added queue tests cover deduplication, concurrency/queue bounds, context scope, correct line/session persistence, late-result suppression after cancellation, error redaction and retry.
- Native Electron integration passes: transcript entry, reference-note saving, API connection/model suggestions, streamed answer, floating prompter, restricted overlay IPC, report generation/export, automatic inline translation without a manual Translate click, bilingual export, meeting library, and restart persistence of translated lines.
- Integration checks assert that the API key is absent from boot/settings bridge data and plaintext preferences.
- API behavior was tested against an HTTP fixture with a dummy key. No real user key was available, and no paid OpenAI requests were made. Account/model access and actual generation quality must be checked using the user's key.

## Retained speech checks from v0.1.0

The speech pipeline was retained. Earlier checks installed/loaded the real tiny model on CPU INT8, transcribed OpenAI Whisper's public JFK audio fixture, and validated synthetic-microphone capture in Electron, 16 kHz PCM buffering, final partial-buffer flush, a valid WAV recording and finished-session metadata.

Physical Windows microphones/system loopback, macOS capture, long meetings, OS keychain integration on Windows and actual API latency remain unverified in this environment. Key persistence falls back to memory when OS encryption is unavailable. The source ZIP excludes runtimes, dependencies, virtual environments, real API keys and model weights.
