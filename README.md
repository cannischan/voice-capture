# Dictamate 4000 — voice capture, transcribed, into your notes

A web-based dictaphone that records a voice note, transcribes it with OpenAI Whisper, and downloads the result as a Markdown file you can save anywhere.

→ **Live site:** https://cannischan.github.io/dictamate-4000/

---

## Why I built this

> I sometimes have an idea I just want to jot down, but I'd rather use voice because it's quick.
>
> I use an iPhone, and the built-in voice recorder is not connected to AI — I find it not useful. I want to be able to transcribe and have access to the full transcript I said, and actually be able to use AI on top of it later.
>
> Essentially, I want **Granola, but for personal use**, processed against my own AI account — not someone else's servers.
>
> I don't need to replay the recording — I never do in fact. I just want to start the app on my phone, talk, and forget about it. Start-up time matters.
>
> I'd like a simple, friendly interface to read through the text, and I want it saved as **Markdown** so it integrates with my Obsidian vault and folders that Claude Code can read on my local machine.

That's the brief. Dictamate is the smallest thing that delivers it: a static web page, your own Whisper API key, your own files on your own device.

---

## What it does

1. **Tap the big red REC button** — recording starts in under a second
2. **Tap STOP (or REC again)** when you're done
3. **Audio is sent to OpenAI Whisper** with your API key
4. **A `.md` file downloads** into your browser's downloads folder, formatted like:

   ```markdown
   ---
   type: voice-note
   date: 2026-05-30T14:23
   ---

   The thing I just said, transcribed verbatim…
   ```

5. **The transcript also appears in the Tape Library** below the device — tap any card to read the full text, copy it, or re-download.

You drag the `.md` into your Obsidian vault (or wherever you keep notes). AI summarisation / tagging / linking is **deferred** — do it later in Obsidian, Claude Code, or whatever you prefer.

---

## Getting started

### One-time setup

1. **Get an OpenAI API key** — https://platform.openai.com → API Keys → Create new key. Add a payment method (Whisper is ~$0.006 / minute of audio).
2. Open the live site on your phone (or wherever).
3. Tap the **screw / gear** in the top-right of the device → paste your API key → Save.
4. (iPhone) **Add to Home Screen** so it opens like an app.

### Daily use

- Open Dictamate from your home screen
- Tap REC, talk, tap STOP
- Save/share the `.md` file into your vault

---

## Architecture summary

Browser → OpenAI Whisper → Markdown download. No server, no signup, no third-party tracking. Full diagrams and component breakdown in [`dictamate-4000-architecture.md`](./dictamate-4000-architecture.md).

```
dictamate-4000/
├── index.html                       static markup
├── styles.css                       presentation
├── app.js                           recording / Whisper / history
├── manifest.webmanifest             install metadata
├── icon.svg                         source app icon
├── icon-180.png                     iPhone Home Screen icon
├── icon-192.png                     web app icon
├── icon-512.png                     web app icon
├── icon-1024.png                    high-resolution icon source
├── README.md                        this file
└── dictamate-4000-architecture.md   detailed architecture
```

---

## Security

This is a personal tool, but it's built with reasonable web security practices.

### What's in place

- **Strict Content Security Policy** (declared in the page's `<meta http-equiv>`):
  - Scripts must come from the same origin — no inline JS, no `eval`, no third-party JS
  - Styles only from the page itself + Google Fonts
  - Network calls (`connect-src`) restricted to `api.openai.com`
  - `frame-ancestors 'none'` blocks clickjacking
  - `form-action 'none'` blocks form-based exfiltration
- **XSS-safe rendering** — every piece of user-controlled text (transcripts, dates) is written via `textContent`. The code never uses `innerHTML` for dynamic content, so a transcript that happens to contain `<script>` is rendered as literal characters.
- **HTTPS only** — GitHub Pages serves over HTTPS, and `getUserMedia` (microphone access) refuses to run on plain HTTP. Your audio never travels over an unencrypted connection.
- **Referrer disabled** — `<meta name="referrer" content="no-referrer">` so other domains you might link from don't appear in the Referer header sent to OpenAI.
- **No third-party trackers or analytics.** Only three external origins are ever contacted: `api.openai.com`, `fonts.googleapis.com`, `fonts.gstatic.com`.
- **API key never leaves your browser** — it's stored in `localStorage` on your device and sent directly to OpenAI. The site author cannot see it. No backend exists to leak it.
- **Audio handling** — recorded chunks live only in memory (`Blob`s) during the request and are released after upload. They are never persisted on disk by the app.

### The honest trade-offs

- **API key in `localStorage`.** Anyone with physical access to your browser, or any script that runs on this origin, can read the key. This is mitigated by the CSP (which prevents arbitrary scripts from running) and by the fact that the site is hosted on the user's chosen origin with no third-party code. For a personal tool, this is the standard trade-off. For a multi-user product, you'd put the key behind a backend.
- **OpenAI sees your audio.** That's intrinsic to using their API. Per OpenAI's API policy, audio sent to Whisper is not used for training and isn't retained by default — but you are sending the recording to a third party, and you should be okay with that before using this app.
- **No CSRF / auth concerns** because there is no backend and no session.

---

## Limitations

Honest list of what this *won't* do today, so you can decide whether the trade-offs work for you.

### Storage and sync
- **No multi-device sync.** The Tape Library is per-browser, per-device. The `.md` files are the source of truth.
- **Last 50 notes only** in the Tape Library (the cap, not a hard browser limit). Older entries are dropped from the in-app list — but their `.md` files are already on your device.
- **Private / Incognito mode wipes localStorage** when you close the window. Recording works, but the Tape Library entry won't survive the session.
- **Clearing site data** in your browser deletes the API key and Tape Library. The `.md` files are unaffected.

### Capture
- **Requires internet** for Whisper. No offline transcription. (If you need offline, run `whisper.cpp` locally.)
- **Microphone permission required.** Browsers prompt per-origin; if you deny once you'll need to re-grant via site settings.
- **Mixed English/Cantonese notes supported.** The transcription prompt is tuned for voice notes that switch between English and Cantonese, using Traditional Chinese for Cantonese while preserving English words, product names, and code.
- **Language prompt is customizable.** If you speak different languages, edit `TRANSCRIPTION_PROMPT` in `app.js` to describe the languages and output style you want.
- **Recording while screen is off** is unreliable on mobile browsers. While recording, Dictamate asks the browser for a screen wake lock so the display should stay on where supported; if the browser does not support wake locks, keep the screen on manually.
- **iOS Safari quirks** — `MediaRecorder` works on iOS 14.5+, but some MIME types differ. The app probes and falls back automatically.
- **25 MB Whisper file limit** — roughly 90 minutes of compressed audio per request. More than enough for voice notes.

### Output
- **The browser chooses where files go.** Desktop browsers download the `.md` file directly. On iPhone, Safari may use the native share/save sheet instead because generated Markdown downloads are often previewed rather than saved automatically.
- **No automatic AI processing.** Summarisation, tagging, linking are deferred to you and your tools (Claude Code, Obsidian plugins, etc.). By design — keeps capture fast and cost low.

### Stylistic / minor
- **Win95 buttons inside a 90s dictaphone is intentionally mixed.** Not a bug.

---

## What this is not

- **Not a Granola replacement for meetings.** Granola is built for multi-speaker conversations, calendar integration, and meeting transcription. Dictamate is the opposite: a **personal dictaphone** for capturing your own thoughts when nobody else is talking. The interface is deliberately modelled on a physical dictaphone — one big red button, no preview, no replay, no settings to fiddle with — so the loop is **tap → talk → done**. If you find yourself wanting to scrub through audio or label speakers, this isn't the right tool.
- **Not a notes app** — it produces files. Your notes app is wherever you put those files.
- **Not a SaaS product.** The site is hosted publicly on GitHub Pages so anyone can open it, but it is **bring-your-own-API-key**: every visitor has to paste their own OpenAI key into Settings on their own device before the record button does anything. Without a key, the app simply opens the Settings modal. There is no shared backend, no account, and no way for me (or anyone) to bill you — costs go directly from you to OpenAI, in cents per minute.

---

## Costs

OpenAI Whisper is $0.006 per minute of audio. Some napkin maths:

| Daily use         | Monthly cost (Whisper) |
|-------------------|------------------------|
| 5 × 2-min notes   | ~$1.80                 |
| 10 × 5-min notes  | ~$9                    |
| 30 × 10-min notes | ~$54                   |

GitHub Pages hosting is free.

---

## Future possibilities

Not promised, just noted:
- Auto-save into a folder via the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (Chromium browsers)
- Optional AI summarisation step before save (Claude API)
- IndexedDB-backed history instead of localStorage, lifting the 50-note cap
- Local Whisper (no API) via `whisper.cpp` running on a Mac, with the PWA pointing at it
