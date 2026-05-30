# Architecture

Dictamate 4000 is a single-page static web app (PWA) hosted on GitHub Pages. It records audio in the browser, transcribes it through the OpenAI Whisper API using a key you supply, and downloads a Markdown file you can drag into your Obsidian vault.

There is no backend. The page, the styles, and the script are static files served by GitHub Pages.

---

## High-level flow

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Browser     │───▶│  OpenAI Whisper  │───▶│  Browser        │
│  MediaRec.   │    │  /transcriptions │    │  download .md   │
│  (mic audio) │    │  (your API key)  │    │  to your device │
└──────────────┘    └──────────────────┘    └─────────────────┘
       │                                              │
       │                  ┌───────────────────────┐   │
       └─────────────────▶│  localStorage         │◀──┘
                          │  (Tape Library: last  │
                          │   50 transcripts)     │
                          └───────────────────────┘
```

The audio leaves your device only to be transcribed. Per OpenAI's API policy, Whisper does not retain inputs by default. The resulting `.md` file is downloaded to your device — nothing is uploaded to GitHub Pages or any third party.

---

## File layout

```
voice-capture/
├── index.html                       # markup only
├── styles.css                       # all CSS
├── app.js                           # all JS (recording, Whisper call, history, UI)
├── README.md                        # problem, usage, security, limits
├── voice-capture-architecture.md    # this file
└── .gitignore
```

The CSS / JS are kept in separate files so the page can declare a strict Content Security Policy without `'unsafe-inline'`.

---

## Components

### 1. UI shell — `index.html`

Static markup for a stylised dictaphone:
- LCD-style display (`status`, `lcdTime`, `lcdCount`, `tapeStrip`)
- Big red `recordBtn` (also acts as stop while recording)
- Separate `stopBtn` for explicit stop
- Settings "screw" button → modal with API key
- Tape Library section — list of saved transcripts
- Transcript modal — full text view with Close / Download / Copy

No inline scripts, no inline styles, no inline event handlers — everything is wired up in `app.js`.

### 2. Styles — `styles.css`

Pure presentation. The "look" is a beige plastic device on a dark surface, with a green LCD, red record button, and lined-paper cards in the Tape Library. Note transcript buttons are intentionally Windows 95-style (silver, bevelled, Tahoma) — a deliberate stylistic mix.

External fonts loaded from Google Fonts: VT323 (LCD), Oswald (engraved labels), Special Elite (typewriter body text).

### 3. Logic — `app.js`

Plain JS, no build step, no dependencies.

**Recording**
- `navigator.mediaDevices.getUserMedia({ audio })` → mic stream
- `MediaRecorder` with `audio/mp4`, falling back to `audio/webm;codecs=opus`
- 1-second chunks via `start(1000)`; chunks collected into `audioChunks[]`

**Transcription**
- On stop, chunks are assembled into a `Blob` and POSTed to `https://api.openai.com/v1/audio/transcriptions`
- `model=whisper-1`, `response_format=text`
- API key is read from `localStorage` and sent as a `Bearer` token

**Output**
- A markdown blob is built with a `voice-note` frontmatter block and the raw transcript
- `URL.createObjectURL` + a hidden `<a download>` triggers a browser download
- The transcript is also stored in `localStorage` under `voice_notes` (capped at 50 entries)

**Tape Library**
- Stored entries: `{ date: ISO string, text: full transcript, preview: first 200 chars }`
- Rendered as cards. Click → opens the transcript modal with the full text.
- Cards are built with `document.createElement` + `textContent` — never `innerHTML` — so transcript content can never be interpreted as HTML.

### 4. Storage

All app state lives in browser `localStorage` keyed under one origin (the GitHub Pages domain):

| Key                | Contents                                              |
|--------------------|-------------------------------------------------------|
| `whisper_api_key`  | The user's OpenAI API key (plaintext)                 |
| `voice_notes`      | JSON array of `{ date, text, preview }` (max 50)      |

Each origin has 5–10 MB of localStorage available. A 2-minute transcript is roughly 2 KB of text, so 50 entries occupy ~100 KB — well under the limit.

The downloaded `.md` files are the canonical record. localStorage is a quick-access cache that can be wiped without losing anything important.

---

## Hosting

Served as static files via GitHub Pages from the `main` branch root. Pages serves over HTTPS by default — required for `getUserMedia` to work at all.

---

## External dependencies at runtime

| Origin                      | Why                                  |
|-----------------------------|--------------------------------------|
| `fonts.googleapis.com`      | Google Fonts CSS                     |
| `fonts.gstatic.com`         | Google Fonts font files              |
| `api.openai.com`            | Whisper transcription endpoint       |

These are the only hosts allowed by the page's Content Security Policy.

---

## Security posture

Detailed in [README.md](./README.md#security). In brief:

- **CSP** (declared in the HTML `<meta>`) restricts scripts to same-origin, blocks inline JS, and limits network calls to OpenAI + Google Fonts.
- **XSS-safe rendering** — all transcript and date text rendered via `textContent`, never `innerHTML`.
- **HTTPS-only** — required by `getUserMedia` and by GitHub Pages.
- **No third-party trackers / analytics.**
- **`referrer="no-referrer"`** so other sites can't see this page in the Referer header.
- **API key trade-off** — stored in `localStorage` and sent directly to OpenAI from the browser. Acceptable for a personal tool on a personal device; not appropriate for a multi-user product (see Limitations).

---

## Why this shape

The original brief: a fast, voice-first way to capture ideas, transcribed by AI, output as markdown that drops into Obsidian, no signup, no servers, no per-user accounts.

A static page is the smallest thing that meets all of that:
- **No server** → nothing to deploy, no auth, no costs unless you record
- **Open in browser, tap record** → fast start
- **Browser download** → markdown lands in `Downloads/`, drag to vault
- **Local history** → see what you said recently without round-tripping to a server

The Python script (`voice-server.py`) and the iOS-app spec (`voice-capture-ios-app.md`) were earlier sketches of richer architectures — a local server that saves directly to a vault path, or a native Swift app. Both were dropped because the static PWA already covers the core need, and adding either reintroduces the things the static version avoided (a process to run, a build to ship).
