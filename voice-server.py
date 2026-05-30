#!/usr/bin/env python3
"""
Tiny server that receives voice note transcripts and saves them as .md files
to your Obsidian vault. Run this on your Mac.

Usage:
  python3 voice-server.py --vault ~/path/to/obsidian/vault/voice-notes

Then configure the PWA with your Mac's local IP (e.g. http://192.168.1.50:8080)
"""

import argparse
import json
import os
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler


class VoiceNoteHandler(BaseHTTPRequestHandler):
    vault_path = ""

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != "/save":
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
            transcript = data.get("transcript", "").strip()
            if not transcript:
                raise ValueError("Empty transcript")
        except (json.JSONDecodeError, ValueError) as e:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        # Build markdown
        now = datetime.now()
        date_stamp = now.strftime("%Y-%m-%d_%H%M")
        iso_date = now.strftime("%Y-%m-%dT%H:%M")

        markdown = f"""---
type: voice-note
date: {iso_date}
---

{transcript}
"""

        filename = f"{date_stamp}_voice-note.md"
        filepath = os.path.join(self.vault_path, filename)

        os.makedirs(self.vault_path, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(markdown)

        print(f"Saved: {filepath}")

        self.send_response(200)
        self._cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"saved": filename}).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format, *args):
        # Quieter logging
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="Voice note save server")
    parser.add_argument(
        "--vault",
        required=True,
        help="Path to your Obsidian vault's voice-notes folder"
    )
    parser.add_argument("--port", type=int, default=8080, help="Port (default: 8080)")
    args = parser.parse_args()

    vault_path = os.path.expanduser(args.vault)
    os.makedirs(vault_path, exist_ok=True)

    VoiceNoteHandler.vault_path = vault_path

    server = HTTPServer(("0.0.0.0", args.port), VoiceNoteHandler)
    print(f"Voice note server running on port {args.port}")
    print(f"Saving to: {vault_path}")
    print(f"Configure the PWA with: http://<your-mac-ip>:{args.port}")
    print()

    # Show local IP for convenience
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        print(f"Your Mac's local IP appears to be: {local_ip}")
        print(f"So the server URL would be: http://{local_ip}:{args.port}")
    except Exception:
        pass

    print("\nPress Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
