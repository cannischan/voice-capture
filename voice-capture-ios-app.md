# Voice Capture iOS App — Architecture & Code

A minimal SwiftUI app: one button to record, Whisper API to transcribe, markdown files saved to a folder accessible by Obsidian.

---

## Requirements

- **Xcode** (latest stable)
- **Apple Developer account** (free tier works — you can sideload to your own device)
- **OpenAI API key** (for Whisper — $0.006/min)
- **iPhone running iOS 17+**

---

## Project Setup

1. Open Xcode → New Project → **App**
2. Product Name: `VoiceCapture`
3. Interface: **SwiftUI**
4. Language: **Swift**
5. Bundle ID: `com.yourname.voicecapture`

### Capabilities to Enable

In your target's **Signing & Capabilities**:
- **iCloud** → check **iCloud Documents** (for saving to iCloud Drive)

In **Info.plist**, add:
- `NSMicrophoneUsageDescription` → "Records voice notes for transcription"

---

## Architecture

```
┌─────────────────────────────────┐
│         ContentView             │
│  ┌───────────────────────────┐  │
│  │     Big Record Button     │  │
│  │     (tap to start/stop)   │  │
│  └───────────────────────────┘  │
│         status label            │
│         past notes list         │
└──────────┬──────────────────────┘
           │
     ┌─────▼─────┐
     │ AudioRecorder │  ← AVAudioRecorder wrapper
     └─────┬─────┘
           │ .m4a file
     ┌─────▼─────┐
     │ WhisperAPI │  ← multipart upload to OpenAI
     └─────┬─────┘
           │ transcript text
     ┌─────▼──────┐
     │ FileSaver   │  ← writes .md to iCloud Drive / local folder
     └────────────┘
```

Three files, ~200 lines total.

---

## File 1: `AudioRecorder.swift`

Handles recording audio to a temporary .m4a file.

```swift
import AVFoundation
import Foundation

class AudioRecorder: ObservableObject {
    @Published var isRecording = false
    @Published var recordingDuration: TimeInterval = 0

    private var audioRecorder: AVAudioRecorder?
    private var timer: Timer?
    private(set) var recordingURL: URL?

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            print("Failed to set up audio session: \(error)")
            return
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.record()
            recordingURL = url
            isRecording = true
            recordingDuration = 0
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                self.recordingDuration += 1
            }
        } catch {
            print("Failed to start recording: \(error)")
        }
    }

    func stopRecording() -> URL? {
        audioRecorder?.stop()
        timer?.invalidate()
        timer = nil
        isRecording = false
        return recordingURL
    }
}
```

---

## File 2: `WhisperAPI.swift`

Sends the .m4a file to OpenAI's Whisper API as proper multipart form data.

```swift
import Foundation

struct WhisperAPI {
    // IMPORTANT: In production, store this in Keychain or a config file.
    // Hardcoding here for simplicity since this is a personal app on your device.
    static let apiKey = "sk-proj-YOUR_KEY_HERE"

    static func transcribe(audioURL: URL) async throws -> String {
        let url = URL(string: "https://api.openai.com/v1/audio/transcriptions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)",
                        forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Add audio file
        let audioData = try Data(contentsOf: audioURL)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Add model parameter
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"model\"\r\n\r\n".data(using: .utf8)!)
        body.append("whisper-1\r\n".data(using: .utf8)!)

        // Add response format
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"response_format\"\r\n\r\n".data(using: .utf8)!)
        body.append("text\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "WhisperAPI",
                         code: (response as? HTTPURLResponse)?.statusCode ?? 0,
                         userInfo: [NSLocalizedDescriptionKey: errorBody])
        }

        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}
```

---

## File 3: `ContentView.swift`

The entire UI — a big record button, a status label, and a list of past notes.

```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var recorder = AudioRecorder()
    @State private var status: String = "Tap to record"
    @State private var isProcessing = false
    @State private var pastNotes: [SavedNote] = []

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Record button
            Button(action: handleTap) {
                ZStack {
                    Circle()
                        .fill(recorder.isRecording ? Color.red : Color.blue)
                        .frame(width: 120, height: 120)
                        .shadow(radius: 8)

                    if isProcessing {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.5)
                    } else if recorder.isRecording {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.white)
                            .frame(width: 36, height: 36)
                    } else {
                        Circle()
                            .fill(.white)
                            .frame(width: 36, height: 36)
                    }
                }
            }
            .disabled(isProcessing)

            // Duration / status
            if recorder.isRecording {
                Text(formatDuration(recorder.recordingDuration))
                    .font(.system(.title, design: .monospaced))
                    .foregroundColor(.red)
            } else {
                Text(status)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Past notes
            if !pastNotes.isEmpty {
                List(pastNotes) { note in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note.date, style: .date)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(note.preview)
                            .font(.body)
                            .lineLimit(2)
                    }
                }
                .listStyle(.plain)
                .frame(maxHeight: 300)
            }
        }
        .padding()
        .onAppear { loadPastNotes() }
    }

    private func handleTap() {
        if recorder.isRecording {
            stopAndTranscribe()
        } else {
            recorder.startRecording()
            status = "Recording..."
        }
    }

    private func stopAndTranscribe() {
        guard let audioURL = recorder.stopRecording() else { return }
        isProcessing = true
        status = "Transcribing..."

        Task {
            do {
                let transcript = try await WhisperAPI.transcribe(audioURL: audioURL)
                let note = saveMarkdown(transcript: transcript)
                await MainActor.run {
                    pastNotes.insert(note, at: 0)
                    status = "Saved!"
                    isProcessing = false
                }
                // Clean up temp audio file
                try? FileManager.default.removeItem(at: audioURL)
            } catch {
                await MainActor.run {
                    status = "Error: \(error.localizedDescription)"
                    isProcessing = false
                }
            }
        }
    }

    private func saveMarkdown(transcript: String) -> SavedNote {
        let now = Date()
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd_HHmm"
        let dateStamp = dateFormatter.string(from: now)

        let isoFormatter = DateFormatter()
        isoFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        let isoDate = isoFormatter.string(from: now)

        let markdown = """
        ---
        type: voice-note
        date: \(isoDate)
        ---

        \(transcript)
        """

        let filename = "\(dateStamp)_voice-note.md"

        // Save to app's Documents directory (syncs via iCloud if enabled)
        // OR save to a shared container accessible by Obsidian
        let docsURL = getVoiceNotesDirectory()
        let fileURL = docsURL.appendingPathComponent(filename)

        try? markdown.write(to: fileURL, atomically: true, encoding: .utf8)

        return SavedNote(
            id: UUID(),
            date: now,
            preview: String(transcript.prefix(100)),
            url: fileURL
        )
    }

    private func getVoiceNotesDirectory() -> URL {
        // Option 1: App's documents directory (simple, works immediately)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let voiceNotes = docs.appendingPathComponent("voice-notes")
        try? FileManager.default.createDirectory(at: voiceNotes,
                                                  withIntermediateDirectories: true)
        return voiceNotes

        // Option 2: iCloud Drive (accessible by Obsidian)
        // Uncomment and modify after enabling iCloud Documents capability:
        //
        // if let iCloudURL = FileManager.default.url(forUbiquityContainerIdentifier: nil)?
        //     .appendingPathComponent("Documents")
        //     .appendingPathComponent("voice-notes") {
        //     try? FileManager.default.createDirectory(at: iCloudURL,
        //                                              withIntermediateDirectories: true)
        //     return iCloudURL
        // }
        // return docs.appendingPathComponent("voice-notes") // fallback
    }

    private func loadPastNotes() {
        let dir = getVoiceNotesDirectory()
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.creationDateKey],
            options: .skipsHiddenFiles
        ) else { return }

        pastNotes = files
            .filter { $0.pathExtension == "md" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .prefix(20)
            .compactMap { url in
                guard let content = try? String(contentsOf: url, encoding: .utf8) else { return nil }
                let preview = content
                    .components(separatedBy: "---")
                    .last?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .prefix(100) ?? ""
                return SavedNote(
                    id: UUID(),
                    date: (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date(),
                    preview: String(preview),
                    url: url
                )
            }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}

struct SavedNote: Identifiable {
    let id: UUID
    let date: Date
    let preview: String
    let url: URL
}
```

---

## File 4: `VoiceCaptureApp.swift`

The app entry point (Xcode generates this, just make sure it looks like this):

```swift
import SwiftUI

@main
struct VoiceCaptureApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

---

## Getting Files into Obsidian

You have a few options, from simplest to most integrated:

### Option A: iCloud Drive (recommended)

Enable iCloud Documents in your app's capabilities, then uncomment the iCloud code in `getVoiceNotesDirectory()`. Files save to `iCloud Drive/VoiceCapture/Documents/voice-notes/`. In Obsidian, set your vault to use iCloud and create a symlink or configure Obsidian to look at that folder.

### Option B: Shared App Group

If you use Obsidian's iCloud vault, you can write directly to Obsidian's iCloud container — but this requires knowing Obsidian's container identifier. A simpler approach: use the Files app integration. Add `UIFileSharingEnabled = YES` and `LSSupportsOpeningDocumentsInPlace = YES` to Info.plist. This makes your app's Documents folder visible in the Files app, and you can manually move files or set up a Shortcut to copy them.

### Option C: Export to Files on save

Add a share sheet or "Save to Files" step after each transcription. This lets you pick your Obsidian vault folder each time. Less automated but works immediately with zero configuration:

```swift
// Add to ContentView after saving:
let activityVC = UIActivityViewController(
    activityItems: [fileURL],
    applicationActivities: nil
)
// Present it
```

### Option D: Local folder on Mac (via Claude Code)

If your priority is Claude Code access rather than Obsidian mobile, just let the files sync to iCloud and access them from your Mac at `~/Library/Mobile Documents/iCloud~com~yourname~voicecapture/Documents/voice-notes/`.

---

## Building & Running

1. Open the project in Xcode
2. Replace `sk-proj-YOUR_KEY_HERE` in `WhisperAPI.swift` with your actual OpenAI API key
3. Connect your iPhone via USB
4. Select your iPhone as the build target
5. Hit Run (⌘R)
6. Trust the developer certificate on your iPhone: Settings → General → VPN & Device Management → your developer profile → Trust
7. The app installs and you can launch it from your home screen

### Sideloading Notes (Free Developer Account)

- Free accounts require re-signing every 7 days (just re-run from Xcode)
- Paid developer account ($99/year) gives you 1-year signing
- The app runs fully on-device between re-signings — only the certificate expires

---

## Optional: Action Button Integration

You can't directly map a third-party app to the Action Button, but you can:
1. Create a Shortcut with a single action: **Open App → VoiceCapture**
2. Map that Shortcut to the Action Button
3. One long-press → app opens → tap the big button to record

For even faster access, add the app to your Lock Screen as a widget or put it on your home screen dock.

---

## Cost

- **Whisper API:** $0.006/min (~3 cents per 5-min note)
- **Apple Developer Account:** Free (7-day re-sign) or $99/year (annual signing)
- **Claude processing:** $0/note (run later via Claude Code when needed)
- **Storage:** Negligible (markdown files are tiny)
