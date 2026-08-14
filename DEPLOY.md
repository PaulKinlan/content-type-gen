# Deno Deploy — content-type-gen

The deployed server turns uploaded media into a generated mini-app; the media
metadata is the prompt. A Gemini text model enriches the title/description/
chapters when `GEMINI_API_KEY` is set; otherwise the offline passthrough is used
(never fails for a missing key).

## Deploy

```bash
deployctl deploy \
  --project=content-type-gen \
  --entrypoint=deploy.ts \
  --include=public \
  --token="$DENO_DEPLOY_TOKEN"
```

## Secret

```bash
deployctl secret set GEMINI_API_KEY --project=content-type-gen
```

The enricher uses `gemini-3.1-flash` (any Gemini text-model key works). Without
the secret, generated pages use the deterministic offline title/description/
chapters.

## Note

Deno Deploy has no ffprobe/ffmpeg; the upload probe falls back to
extension/filename metadata when ffprobe is unavailable. Media files must be
hosted/persisted separately (Deno Deploy has no writable FS) — this deployment
serves the pipeline + pages; durable media storage is a follow-up.
