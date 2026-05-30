# Voice Capture → Markdown: Architecture Doc

A personal voice-to-text capture tool that runs on your iPhone, transcribes via your own Whisper API key, and saves raw markdown transcripts to your Obsidian vault. AI processing (summaries, tags) is deferred — run it later via Claude Code or Obsidian when you actually need it.

---

## System Overview

```
┌─────────────┐    ┌───────────────┐    ┌──────────────┐
│  iPhone      │───▶│  Whisper API  │───▶│ iCloud Drive │
│  Shortcut    │    │  (your key)   │    │ /Obsidian/   │
│              │    │               │    │  vault/voice │
│  Action      │    │  $0.006/min   │    │              │
│  Button      │    │               │    │  .md files   │
└─────────────┘    └───────────────┘    └──────────────┘
```

**Total cost per 5-minute voice note:** ~$0.03

---

## Component 1: iOS Shortcut

This is the entire "app." It lives as a Shortcut and maps to your Action Button.

### Flow

1. **Record Audio** — Shortcut action: `Record Audio`. Starts immediately, no config screens. You press stop when done.
2. **Send to Whisper API** — Shortcut action: `Get Contents of URL` (POST).
3. **Format as markdown** — Shortcut action: `Text` block to assemble the file.
4. **Save to iCloud** — Shortcut action: `Save File` to your Obsidian vault folder.
5. **Notify** — Shortcut action: `Show Notification` ("Voice note saved").

### Startup Time

The Shortcut starts recording on the very first action. From Action Button press to recording: **< 1 second**. No splash screen, no login, no UI to navigate.

### Action Button Setup

`Settings → Action Button → Shortcut → [select your shortcut]`

One long-press of the Action Button → recording starts.

---

## Component 2: Whisper API Call

### Request

```
POST https://api.openai.com/v1/audio/transcriptions
Headers:
  Authorization: Bearer YOUR_OPENAI_API_KEY
  Content-Type: multipart/form-data
Body:
  file: [recorded audio file]
  model: "whisper-1"
  response_format: "text"
  language: "en"  (optional, improves accuracy)
```

### Shortcut Implementation

In the Shortcut, use **Get Contents of URL**:

- **URL:** `https://api.openai.com/v1/audio/transcriptions`
- **Method:** POST
- **Headers:** `Authorization: Bearer sk-...`
- **Request Body:** Form (not JSON)
  - `file`: the recorded audio (as File)
  - `model`: `whisper-1` (text)
  - `response_format`: `text` (text)

The response is plain text — the full transcript.

### Notes

- Whisper handles filler words, pauses, and messy speech well.
- Max file size: 25 MB (~90 min of compressed audio). More than enough.
- Audio is sent as m4a (iPhone default), which Whisper accepts natively.
- Latency: typically 5-15 seconds for a 5-minute recording.

---

## Component 3: Markdown Output

### File Naming

Format: `YYYY-MM-DD_HHmm_voice-note.md`

Example: `2026-05-30_1423_voice-note.md`

In Shortcuts, use `Format Date` with custom format `yyyy-MM-dd_HHmm` on `Current Date`.

### File Structure

```markdown
---
type: voice-note
date: 2026-05-30T14:23
---

I sometimes have some idea I just want to jot down, but I am thinking
of using voice as a medium because it is quick. I use an iPhone and
the voice recorder is not connected to AI, and I find it not useful.
I want to be able to transcribe and have access to the full transcript
I said, and actually be able to use AI on top of it...
```

Clean and minimal — just frontmatter with type and date, then the raw transcript as the body. No headers, no sections, just the words you said. This keeps the files maximally useful as input to Claude Code or any other tool later.

### Save Location

Save to: `iCloud Drive/Obsidian/[your-vault-name]/voice-notes/`

Create the `voice-notes` folder in your vault first. All voice notes land here, organized by date in the filename.

---

## Component 4: Obsidian Integration

### Browsing

The files just appear in your vault. You can:
- Browse the `voice-notes/` folder directly
- Use Obsidian's search to find content across all transcripts

### Useful Obsidian Plugins (optional)

- **Dataview** — query your voice notes like a database (`TABLE date FROM "voice-notes" SORT date DESC`)
- **Calendar** — see which days you captured voice notes

### Claude Code Integration

Since the files are plain markdown on your local machine, Claude Code can read them directly from your vault path. This is where AI processing happens — on demand, not at capture time. You can ask Claude Code to:
- Summarize a specific note or batch of notes
- Extract action items or key ideas
- Tag and categorize notes retroactively
- Search across all voice notes for a topic
- Synthesize ideas from multiple notes into a document

This "transcribe now, process later" approach means you only pay for AI when you actually need it, and you get to direct what kind of processing you want rather than getting a generic summary every time.

---

## API Key Setup

### OpenAI (Whisper)

1. Go to `platform.openai.com`
2. Create account / sign in
3. Settings → API Keys → Create new key
4. Add billing (pay-as-you-go, no minimum)

Store the key in the Shortcut itself (embedded in the URL action header). Since the Shortcut lives only on your device, this is fine for personal use.

---

## Shortcut Build Checklist

Here's the exact sequence of Shortcut actions to create:

```
1.  [Record Audio]
      Quality: Normal
      Start: Immediately

2.  [Set Variable] name: "audioFile" to: [Shortcut Input / Recording]

3.  [Get Contents of URL]
      URL: https://api.openai.com/v1/audio/transcriptions
      Method: POST
      Headers:
        Authorization: Bearer sk-YOUR_KEY
      Request Body: Form
        file: audioFile (File)
        model: whisper-1 (Text)
        response_format: text (Text)

4.  [Set Variable] name: "transcript" to: [Contents of URL]

5.  [Format Date] format: yyyy-MM-dd_HHmm from: Current Date
6.  [Set Variable] name: "dateStamp" to: [Formatted Date]

7.  [Format Date] format: yyyy-MM-dd'T'HH:mm from: Current Date
8.  [Set Variable] name: "isoDate" to: [Formatted Date]

9.  [Text]
      ---
      type: voice-note
      date: [isoDate]
      ---

      [transcript]

10. [Save File]
      Save [Text] to:
      iCloud Drive/Obsidian/YOUR_VAULT/voice-notes/[dateStamp]_voice-note.md
      Ask where to save: OFF

11. [Show Notification]
      Title: Voice Note Saved
      Body: [filename]
```

**That's 11 actions.** The whole thing takes about 2 minutes to build in the Shortcuts app.

---

## Known Limitations & Workarounds

| Limitation | Workaround |
|---|---|
| Shortcuts audio recording has no background mode — screen must stay on | Keep phone unlocked while recording. For hands-free, start recording and set phone down. |
| Whisper has a 25MB file limit | ~90 min of audio. If you go longer, split into chunks (rare for voice notes). |
| No offline mode | Requires internet for the API call. For offline fallback, save the raw audio file to iCloud; transcribe later when online. |
| No AI processing at capture time | By design — process later via Claude Code when you need it. Saves cost and gives you control over what processing you want. |

---

## Future Enhancements

- **AI processing layer**: Add Claude API call back into the Shortcut when you want auto-summaries and tags at capture time.
- **Dedicated web UI**: A simple PWA to browse/search/filter voice notes with a nicer interface than Obsidian's file browser.
- **Whisper locally via Mac**: Run `whisper.cpp` on your Mac when audio syncs via iCloud, avoiding the API call entirely (free, private).
- **Auto-linking**: Have Claude identify connections to existing notes in your vault and add `[[wikilinks]]` automatically.
- **Siri trigger**: "Hey Siri, capture thought" → runs the Shortcut hands-free.
- **Apple Watch**: Trigger from your wrist for even faster capture.
- **Batch processing script**: A Claude Code hook or cron job that processes untagged voice notes in bulk.
