# Deno Deploy — content-type-gen

`deploy.ts` starts a read-only server surface. It creates its ephemeral media
directory before serving, but deliberately disables `POST /api/upload` with
`501 Not Implemented`. Deno Deploy does not provide `ffprobe`, so uploaded bytes
cannot be verified there; there is no filename/MIME fallback and no claim of
durable media storage.

## Deploy

```bash
deployctl deploy \
  --project=content-type-gen \
  --entrypoint=deploy.ts \
  --include=public \
  --token="$DENO_DEPLOY_TOKEN"
```

The root page and static fixtures work, and clearly state that uploads are
unavailable. The ephemeral media directory starts empty, so generated media
pages require a separately designed, validated durable-media integration.

## Optional owner-only enrichment

Gemini is disabled by default. Public `GET /p/*`, `GET /api/page`, ordinary
`POST /api/generate`, pregeneration, and uploads never call Gemini. To expose
the one fixed `POST /api/enrich` owner operation, set all three
secrets/settings:

```bash
deployctl secret set ENABLE_GEMINI_ENRICHMENT --project=content-type-gen # value: 1
deployctl secret set GEMINI_API_KEY --project=content-type-gen
deployctl secret set GEMINI_ENRICHMENT_TOKEN --project=content-type-gen
```

The operation accepts only `{ "file": "stored-media.mp3", "prompt": "..." }` and
requires `Authorization: Bearer <GEMINI_ENRICHMENT_TOKEN>`. It has a fixed
Gemini endpoint/model, sends the API key only in the `x-goog-api-key` header,
and cannot proxy caller-selected URLs, models, or headers. On the default empty
Deploy media directory it will return `404` for media names; enablement alone
does not add storage.
