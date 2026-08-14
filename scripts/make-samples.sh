#!/bin/bash
# Generate sample media files with metadata prompts (the media-as-prompt mechanism).
set -e
mkdir -p media

# 1. A video with a metadata "comment" prompt (talking-to-camera style: color bars + tone)
ffmpeg -y -f lavfi -i "testsrc=duration=8:size=640x360:rate=24" \
  -f lavfi -i "sine=frequency=440:duration=8" \
  -metadata comment="A short talk about the future of the web — generate a keynote-style page" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest media/future-of-web.mp4

# 2. An audio file with a metadata "description" prompt (a voice memo)
ffmpeg -y -f lavfi -i "sine=frequency=330:duration=12" \
  -metadata description="Voice memo: three ideas for offline-first apps — generate a to-do list app" \
  -metadata title="Voice memo: offline-first ideas" \
  -c:a libmp3lame media/voice-memo.mp3

# 3. A second video with no metadata (default prompt path)
ffmpeg -y -f lavfi -i "testsrc2=duration=6:size=480x270:rate=24" \
  -c:v libx264 -pix_fmt yuv420p media/napkin-drawing.mp4

echo "samples written"
