# Third-party software

This source package includes newly written application code. Dependencies are downloaded by npm/pip; model weights are downloaded separately. The package does not contain the analyzed vendor application's code or assets.

| Component | Role | Upstream |
| --- | --- | --- |
| Electron | Desktop application and Chromium audio capture | https://github.com/electron/electron — MIT; distribution includes additional Chromium/Node notices |
| faster-whisper | Local transcription | https://github.com/SYSTRAN/faster-whisper — MIT |
| CTranslate2 | Local model inference | https://github.com/OpenNMT/CTranslate2 — MIT |
| PyAV | Audio file decoding | https://github.com/PyAV-Org/PyAV — BSD-3-Clause; binary wheels include FFmpeg components with their own notices |
| Whisper model weights | Downloaded speech models | https://github.com/openai/whisper — see upstream model/license information |
| Playwright | Optional development-only desktop test | https://github.com/microsoft/playwright — Apache-2.0 |

Transitive dependencies retain the license files shipped with their distributions. The application's MIT license does not relicense those dependencies or any downloaded models.
