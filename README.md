# content-type-gen

Turn an audio or video file into a bespoke, navigable mini-app. The media is the
prompt: `ffprobe` metadata seeds a title, description, seekable chapters, timed
transcript, and related links instead of leaving the user with a bare player.

## Pipeline

| Piece         | Path                  | Responsibility                                                                                                              |
| ------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Probe         | `lib/probe.ts`        | Reads duration, dimensions, codec, container, title, comment, and description with `ffprobe`.                               |
| Generator     | `lib/generate.ts`     | Converts probe + prompt into `PageData`; accepts a provider-agnostic `PageEnricher`.                                        |
| Renderer      | `lib/page.ts`         | Produces the accessible player, chapters, timed transcript highlighting, and related navigation.                            |
| Server        | `server.ts`           | Hosts Range-streamed media, generated routes, JSON API, and multipart uploads.                                              |
| Pregeneration | `scripts/generate.ts` | Writes deterministic static output to `dist/` or a self-contained Pages build to `docs/`.                                   |
| Extension     | `extension/`          | MV3 content action, toolbar action, and context menu that upload selected media to the local generator and open the result. |

The default generator is fully local and deterministic apart from the on-demand
`generatedAt` timestamp. It needs no account or paid AI. The sample fixture at
`media/voice-memo.mp3` carries both title and description tags, so it always
exercises the metadata-as-prompt path. A caller can pass a `PageEnricher` as the
third `generatePage()` argument to add an on-device or hosted model later.

## Run

```sh
# Recreate fixtures (requires ffmpeg)
deno task samples

# Start the uploader and dynamic routes at http://localhost:8080
deno task serve

# Deterministic static output (generatedAt = Unix epoch)
deno task pregenerate

# Self-contained GitHub Pages output, including copied media
deno task pages
```

Load `extension/` as an unpacked extension while the server is running. On a
page containing audio or video, use its injected **Generate a page for this
media** action, the toolbar action, or the media context menu.

The dynamic server binds to `127.0.0.1` and rejects non-loopback hosts and
non-loopback cross-origin API requests. The installed extension obtains a
process-local, unreadable-from-the-web capability before its privileged upload;
state-changing responses never use wildcard CORS. Uploads are capped at 27 MiB
per multipart request, 25 MiB per media file, and 16 KiB per prompt. `ffprobe`
(resolved from `PATH`, or set explicitly with `FFPROBE_PATH`) is required to
verify an upload before its collision-safe filename is persisted. Supported
formats are MP4/M4V, WebM, QuickTime, Ogg video (`.ogv`), MP3, M4A, WAV, Ogg and
Opus audio, and AAC.

Generated `/p/` routes use a URL-safe encoding of the complete stored filename,
including its extension and case. The route shown in the index and upload/API
responses is therefore the canonical link: files such as `clip.mp3`, `clip.wav`,
`Clip.mp3`, and `CLIP.MP3` always have distinct pages and media sources. Static
pregeneration uses the same identity for its HTML filenames.

## Validate

```sh
deno task test       # probe/generator/renderer and server/upload tests
deno task check      # format, lint, and type-check
deno task browser    # real Chromium upload/seek/highlight + unpacked MV3 flow
```

The browser command records deterministic evidence in
`artifacts/upload-generated.png` and `artifacts/extension-fixture.png` (the
browser fixture pins its generated timestamp and media position). It allocates a
free loopback port, verifies a per-process health nonce to prove it is testing
the server it spawned, and runs the extension's injected control through the
shared `runGeneration` path. Chromium's toolbar and native context-menu surfaces
are outside Playwright's page-automation boundary; their listeners are thin
delegates to that same function.
