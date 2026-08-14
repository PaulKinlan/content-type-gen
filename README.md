# content-type-gen

Generate bespoke websites from content-type sources: a video or audio file is
the **prompt** that generates a page around it — the file might not even need
to play.

## The idea

Open a video today and Chrome shows a bare player. Instead, this generates a
bespoke page: title, description, time-coded chapters, a transcript panel, and
related content — all derived from the media's metadata (and optionally an
LLM, via a provider-agnostic seam).

## The pieces

| Piece | Path | What it does |
|---|---|---|
| Server | `server.ts` | Hosts media + generates pages. `GET /p/<slug>` is the generated page; `/media/<file>` is the raw file (Range streaming). |
| Probe | `lib/probe.ts` | ffprobe → duration/dimensions/codec + a metadata comment/description/title tag (the prompt). |
| Generator | `lib/generate.ts` | Probe + prompt → PageData (title/description/chapters/transcript/related). `enrich()` is the LLM seam. |
| Page renderer | `lib/page.ts` | PageData → bespoke HTML (media + layout + chapter nav + transcript). |
| Pregeneration | `scripts/generate.ts` | Build step: generate static HTML for every media file into `dist/`. |
| Extension | `extension/` | MV3: context menu + toolbar action on any page with a `<video>`/`<audio>` → "Generate a page for this media". |
| Sample media | `media/` | ffmpeg-generated files, some carrying metadata prompts. |

## The media-as-prompt mechanism

A media file can carry a prompt in its metadata (`comment`/`description`/`title`
tags — see `lib/probe.ts`). `generatePage` uses that tag as the source prompt
(metadata tag → explicit `?prompt=` → default). The `enrich()` function is the
single place to wire a real model (Whisper transcription, Gemini/OpenAI
summarisation) without changing the pipeline.

## Run

```sh
# samples (needs ffmpeg)
./scripts/make-samples.sh

# serve (generates pages on demand)
deno run --allow-net --allow-read --allow-write --allow-run server.ts
# → http://localhost:8080/

# pregenerate static pages
deno run --allow-read --allow-write scripts/generate.ts
```

## Demos

1. **Bespoke page around media** — `GET /p/future-of-web` renders the video
   wrapped in a generated layout (chapters are time-coded, click to seek).
2. **Media-as-prompt** — `media/voice-memo.mp3` carries a metadata prompt
   ("…generate a to-do list app"); the generated page's title/description come
   from that tag.
3. **Host-an-MP3-as-a-website** — the uploader on `/` accepts an MP3/MP4 and
   returns a generated page URL: the file is now a working mini-site.
4. **Extension** — on any page with media, "Generate a page for this media".
