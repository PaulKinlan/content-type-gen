// server.ts — hosts media files + generates bespoke pages around them.
//
//   deno run --allow-net --allow-read --allow-write --allow-run server.ts
//
// Routes:
//   GET  /                     — index of hosted media + the demo uploader
//   GET  /media/<file>         — the raw media file (Range streaming)
//   GET  /p/<slug>             — the generated page for a media file
//   GET  /api/page?file=<f>    — PageData JSON for a media file
//   POST /api/upload           — multipart upload (audio/video) → generate page
//   POST /api/generate         — generate a page for an existing media file
// The media file itself is the prompt: its metadata tag (or a sidecar prompt)
// drives generation; an LLM seam in lib/generate.ts enriches it.
import { serve } from "std/http/server.ts";
import { basename, extname, join } from "std/path/mod.ts";
import { generatePage, PageData } from "./lib/generate.ts";
import { renderPage } from "./lib/page.ts";

const MEDIA_DIR = "./media";
const PORT = Number(Deno.env.get("PORT") ?? 8080);
const CACHE = new Map<string, PageData>();

await Deno.mkdir(MEDIA_DIR, { recursive: true });

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".aac": "audio/aac",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function listMedia(): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(MEDIA_DIR)) {
    if (
      e.isFile &&
      [".mp4", ".webm", ".mov", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".aac"]
        .includes(extname(e.name).toLowerCase())
    ) {
      out.push(e.name);
    }
  }
  return out.sort();
}

async function pageFor(
  file: string,
  explicitPrompt?: string,
): Promise<PageData> {
  const key = file + (explicitPrompt ? "|" + explicitPrompt : "");
  if (CACHE.has(key)) return CACHE.get(key)!;
  const data = await generatePage(`${MEDIA_DIR}/${file}`, explicitPrompt);
  data.mediaPath = `/media/${file}`;
  CACHE.set(key, data);
  return data;
}

function mediaFileResponse(file: string, range: string | null): Response {
  const path = join(MEDIA_DIR, basename(file));
  let bytes: Uint8Array;
  try {
    bytes = Deno.readFileSync(path);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const ct = contentType(path);
  if (!range) {
    return new Response(bytes as unknown as BodyInit, {
      headers: { "content-type": ct, "accept-ranges": "bytes" },
    });
  }
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (!m) return new Response(bytes as unknown as BodyInit, { headers: { "content-type": ct } });
  const start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Number(m[2]) : bytes.length - 1;
  if (start > end || start >= bytes.length) {
    return new Response("range not satisfiable", { status: 416 });
  }
  end = Math.min(end, bytes.length - 1);
  return new Response(bytes.slice(start, end + 1) as unknown as BodyInit, {
    status: 206,
    headers: {
      "content-type": ct,
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "accept-ranges": "bytes",
    },
  });
}

function indexHtml(media: string[]): string {
  const items = media.map((f) => {
    const slug = f.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "-")
      .toLowerCase();
    return `<li><a href="/p/${slug}">${f}</a> <a class="raw" href="/media/${f}">(raw)</a></li>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>content-type-gen</title>
  <style>body{font:16px/1.55 system-ui,sans-serif;background:#0f1115;color:#e8eaf0;max-width:720px;margin:2rem auto;padding:0 1.5rem}
  a{color:#5ea1ff} .raw{color:#9aa3b2;font-size:.85rem} ul{line-height:2} textarea{width:100%;min-height:120px;background:#171a21;color:#e8eaf0;border:1px solid #23272f;border-radius:8px;padding:.75rem}
  button{background:#5ea1ff;color:#0f1115;border:0;border-radius:8px;padding:.6rem 1rem;font-weight:600;cursor:pointer} #out{margin-top:1rem}</style></head>
  <body><h1>content-type-gen</h1>
  <p>Media files hosted here become bespoke pages — the file is the prompt.</p>
  <h2>Hosted media</h2><ul>${items || "<li>none yet — upload below</li>"}</ul>
  <h2 id="how">Generate a page from an MP3/MP4 (host it as a website)</h2>
  <form id="up" enctype="multipart/form-data"><input type="file" name="media" accept="audio/*,video/*" required>
  <textarea name="prompt" placeholder="Optional prompt describing the page to generate (else the media metadata is the prompt)"></textarea>
  <button type="submit">Upload &amp; generate</button></form>
  <div id="out"></div>
  <script>
    document.getElementById('up').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const out = document.getElementById('out');
      out.textContent = 'Uploading…';
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) { out.innerHTML = 'Generated: <a href="' + data.pageUrl + '">' + data.pageUrl + '</a>'; }
      else { out.textContent = 'Error: ' + (data.error || 'unknown'); }
    });
  </script></body></html>`;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/") {
    return new Response(indexHtml(await listMedia()), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (p.startsWith("/media/")) {
    return mediaFileResponse(
      decodeURIComponent(p.slice("/media/".length)),
      req.headers.get("range"),
    );
  }

  if (p.startsWith("/p/")) {
    const slug = p.slice("/p/".length);
    const media = await listMedia();
    const file = media.find((f) =>
      f.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "-")
        .toLowerCase() === slug
    );
    if (!file) return new Response("not found", { status: 404 });
    const data = await pageFor(
      file,
      url.searchParams.get("prompt") ?? undefined,
    );
    return new Response(renderPage(data), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (p === "/api/page") {
    const file = url.searchParams.get("file");
    if (!file) {
      return Response.json({ error: "file param required" }, { status: 400 });
    }
    const data = await pageFor(
      file,
      url.searchParams.get("prompt") ?? undefined,
    );
    return Response.json(data);
  }

  if (p === "/api/generate" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const file = body.file as string | undefined;
    if (!file) {
      return Response.json({ error: "file required" }, { status: 400 });
    }
    const data = await pageFor(file, body.prompt);
    return Response.json({ ok: true, pageUrl: `/p/${data.slug}`, data });
  }

  if (p === "/api/upload" && req.method === "POST") {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return Response.json({ error: "multipart required" }, { status: 400 });
    }
    const f = form.get("media");
    if (!(f instanceof File)) {
      return Response.json({ error: "media file required" }, { status: 400 });
    }
    const name = f.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const dest = `${MEDIA_DIR}/${name}`;
    await Deno.writeFile(dest, new Uint8Array(await f.arrayBuffer()));
    const prompt = (form.get("prompt") as string) || undefined;
    const data = await pageFor(name, prompt);
    return Response.json({
      ok: true,
      pageUrl: `/p/${data.slug}`,
      title: data.title,
    });
  }

  // Static assets under /public (the extension assets + demo pages)
  const staticPath = join(
    "./public",
    p === "/" ? "index.html" : p.replace(/^\//, ""),
  );
  try {
    const bytes = await Deno.readFile(staticPath);
    return new Response(bytes, {
      headers: { "content-type": contentType(staticPath) },
    });
  } catch { /* fallthrough */ }

  return new Response("not found", { status: 404 });
}

serve(handle, { port: PORT });
console.log(`content-type-gen server on http://localhost:${PORT}/`);
