# Meeting Desk — OpenAI edition, v0.3.0

Desktop meeting assistant with **local speech transcription and your OpenAI API key** for answer scripts, translation and meeting notes.

The application has no subscription charge. OpenAI API requests are billed to your OpenAI account. When you click an AI button, the selected conversation text and reference notes are sent to OpenAI. When Auto-translate new lines is enabled, each new confirmed transcript line and up to two preceding lines are sent automatically. Raw microphone/system audio stays in the local transcription workflow.

## Windows setup

1. Install [Node.js LTS](https://nodejs.org/) and [Python 3.12](https://www.python.org/downloads/).
2. Extract this source ZIP into a writable folder.
3. Run **Setup-Windows.cmd**, then **Start-Windows.cmd**. Or run:

   ```powershell
   npm ci
   npm run setup:speech
   npm start
   ```

4. Open **Setup**. Prepare your chosen speech model (base or tiny is a useful starting point).
5. Paste your **OpenAI API key**, select/type an OpenAI model ID, then **Save settings**. Default: `gpt-4.1-mini`. Use **Check / models** to validate authentication and fetch model candidates. The selected model must support the Responses API; listing a model is not proof of endpoint access.
6. Choose the Assistant output language and Save settings. In Live meeting, turn on **Auto-translate new lines** to translate newly confirmed lines automatically. Start recording or type/paste transcript lines. Use the AI buttons for answers, a manual whole-conversation translation and meeting notes.

Python and speech-model preparation are optional if you only type/paste transcript text. Internet is required for OpenAI generation and first-time dependency/speech-model downloads.

You can supply the key through the `OPENAI_API_KEY` environment variable instead of the interface. For example in PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-key"
npm start
```

Do not put real keys into source files or share them in ZIPs. No key is included in this package.

## Automatic translation

Set your target language in Setup, save, then enable **Auto-translate new lines** in Live meeting. This is off by default. Enabling it sends new confirmed speech/text lines to OpenAI using your selected model and API key; regular API charges apply.

Translations appear under their original line and stream while being generated. This build still transcribes in eight-second chunks, so it does not translate speech before its transcript becomes available. Translation adds API latency. Existing history is not automatically retranslated when the toggle is enabled. Imported recordings use the manual conversation Translate button.

The translation queue allows two concurrent requests and retains up to 32 pending/active lines. Duplicate submissions are ignored. A full queue or failed request shows a per-line error and Retry translation button. Turning the toggle off cancels pending work and ignores late results. Completed translations stay saved. Manual answer/report generation uses a separate request controller, so it does not cancel automatic translation.

Changing output language requires saving settings (stop recording first). Previously completed translations retain their original language labels. Stopping a recording allows already queued translations to finish while the app stays open; closing the app cancels unfinished translation work.

## Credentials and storage

- API calls originate in the Electron main process; the renderer bridge does not return your saved key.
- With Remember key enabled, the app uses Electron's OS-backed `safeStorage`. If secure storage is unavailable (including Linux's basic-text backend), it keeps the key in memory for the current run rather than saving it as plaintext.
- Leave the key field blank to keep the existing key. A newly pasted key replaces the active one. `OPENAI_API_KEY` takes precedence at startup when set.
- API requests go to `https://api.openai.com/v1/responses`, use streaming, and set `store:false`. This parameter is not a claim of provider-wide zero retention.
- Transcripts, notes, settings and optional WAV recordings are readable local files. There is no automatic sharing, email or app telemetry.
- **Open data folder** opens the local app directory (typically `%APPDATA%\free-meeting-desk` on Windows). Meeting files are `meetings/<id>.json`; optional recordings are under `audio/<id>/`. A remembered key is stored separately as `openai-key.bin` using OS encryption.

## Features

- Microphone and system-audio transcription using local faster-whisper CPU INT8 inference, in eight-second chunks.
- Optional independent 16 kHz mono WAV recordings for microphone and system audio.
- Streamed OpenAI answer scripts and click-to-generate meeting reports.
- Automatic per-line translation shown beneath the original transcript; bilingual Markdown export and persistence. A separate button still translates the recent conversation manually.
- Floating answer prompter and reference notes.
- Saved meetings, restart persistence, editable titles/context, deletion and Markdown export.
- Local audio-file transcription for WAV/MP3/M4A/MP4/WebM/OGG/FLAC, up to 500 MB.

This is an independent source prototype, not a signed Windows installer. It does not contain the investigated vendor app's code/assets, cloud services or credentials. It does not implement automatic answer triage, word-by-word interim translation, per-person diarization on one channel, vector search, calendar integration or cloud sharing.

## Audio and hardware

Speech preparation explicitly downloads weights. Normal recognition loads cached files only. Use tiny/base on slower CPUs; small can improve recognition at a higher compute cost. The queue is bounded: if speech falls behind, the app reports skipped chunks instead of growing memory indefinitely. Saved audio, when enabled before recording, can be re-imported afterwards.

System audio captures loopback for the selected screen, not one isolated application's audio. The video track required by Chromium's API is not saved. Mic text is labeled Me; all system speech is Other. Headphones reduce cross-channel echoes. This version does not implement textual echo suppression or automatic speaker separation.

Stopping flushes the final partial buffer and waits for pending transcription. The app saves meeting text locally. Raw audio is retained only when Save audio was enabled. WAV storage uses about 1.9 MB per minute per channel.

Requirements: Node.js 22.12+, Python 3.10–3.13 (3.12 recommended), Windows 10/11 x64 as the intended target. Tests ran on Linux. Physical Windows system-loopback and macOS capture permissions remain unverified. Newer macOS versions may require usage descriptions and appropriately configured packaging for loopback capture. GPU setup is not required by the included CPU speech worker.

## Troubleshooting

- **401:** check your API key and project permissions.
- **429 / quota:** check your OpenAI API project's limits/billing. A ChatGPT subscription is not used for authentication by this application.
- **Unknown/unsupported model:** choose a text model available to your project that supports Responses. You may type the exact ID.
- **No saved key after restart:** secure OS storage may be unavailable; use the environment variable or re-enter the key for the session.
- **Speech not installed:** run `npm run setup:speech`, then prepare a model in Setup.
- **Model not cached:** prepare that speech model while online.
- **Decoder errors:** use the included Python requirements. PyAV is pinned to 16.1.0 for compatibility with faster-whisper 1.2.1.
- **System audio missing:** check device/OS capture permissions. Microphone and file import are separate alternatives.

## Development and validation

```sh
npm run check
npm test
```

Optional native desktop test:

```sh
npm install --no-save --package-lock=false playwright
npm run test:desktop
```

The desktop test injects a temporary local HTTP fixture for OpenAI into its own Electron process. It uses a dummy key and temporary data, makes no paid API calls and removes its test data afterwards. Production code has a fixed OpenAI API endpoint. `MEETING_DESK_DATA_DIR` can override the application's data directory.

See `VALIDATION.md` for actual coverage and limitations. Code is under the included MIT license. Upstream dependencies/model weights retain their respective licenses (`THIRD_PARTY.md`).

## References

- [Official OpenAI streaming documentation](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI GPT-4.1 mini model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Electron capture](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
