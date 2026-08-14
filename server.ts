// Hosts media, exposes the probe → generate → render pipeline, and accepts
// audio/video uploads that become navigable mini-app pages.
import { serve } from "std/http/server.ts";
import { basename, extname, join } from "std/path/mod.ts";
import { generatePage, PageData } from "./lib/generate.ts";
import { renderPage } from "./lib/page.ts";

const DEFAULT_MEDIA_DIR = "./media";
const DEFAULT_PORT = 8080;
const MEDIA_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".opus",
  ".aac",
];
const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
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

function slugForFile(file: string): string {
  return file.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "").toLowerCase();
}

function isMediaFilename(file: string): boolean {
  return basename(file) === file &&
    MEDIA_EXTENSIONS.includes(extname(file).toLowerCase());
}

async function listMedia(mediaDir: string): Promise<string[]> {
  const output: string[] = [];
  for await (const entry of Deno.readDir(mediaDir)) {
    if (entry.isFile && isMediaFilename(entry.name)) output.push(entry.name);
  }
  return output.sort();
}

async function mediaFileResponse(
  mediaDir: string,
  file: string,
  range: string | null,
): Promise<Response> {
  if (!isMediaFilename(file)) return new Response("not found", { status: 404 });
  const path = join(mediaDir, file);
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const headers = {
    "content-type": contentType(path),
    "accept-ranges": "bytes",
  };
  if (!range) return new Response(bytes as BodyInit, { headers });

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return new Response(bytes as BodyInit, { headers });
  const start = match[1] ? Number(match[1]) : 0;
  const requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
  if (start > requestedEnd || start >= bytes.length) {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { "content-range": `bytes */${bytes.length}` },
    });
  }
  const end = Math.min(requestedEnd, bytes.length - 1);
  return new Response(bytes.slice(start, end + 1) as BodyInit, {
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "content-length": String(end - start + 1),
    },
  });
}

function indexHtml(media: string[]): string {
  const items = media.map((file) =>
    `<li><a href="/p/${
      slugForFile(file)
    }">${file}</a> <a class="raw" href="/media/${file}">(raw)</a></li>`
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>content-type-gen</title><style>:root{color-scheme:dark}body{font:1rem/1.55 system-ui,sans-serif;background:#0f1115;color:#f2f4f8;max-width:45rem;margin:2rem auto;padding:0 1.5rem}a{color:#78b3ff}.raw{color:#b7c0ce;font-size:.85rem}ul{line-height:2}label{display:block;font-weight:700;margin-top:1rem}textarea{width:100%;min-height:7.5rem;background:#171a21;color:#f2f4f8;border:1px solid #6d7683;border-radius:.5rem;padding:.75rem}button{background:#78b3ff;color:#0f1115;border:0;border-radius:.5rem;padding:.6rem 1rem;font-weight:700;cursor:pointer}:focus-visible{outline:.2rem solid #fff;outline-offset:.15rem}#out{margin-top:1rem}</style></head>
  <body><main><h1>content-type-gen</h1><p>Upload media and turn it into a generated, navigable mini-app. The file metadata is the prompt.</p>
  <h2>Hosted media</h2><ul>${items || "<li>None yet — upload below.</li>"}</ul>
  <h2 id="how">Host an MP3 or MP4 as a website</h2><form id="up" enctype="multipart/form-data">
  <label for="media-upload">Media file</label><input id="media-upload" type="file" name="media" accept="audio/*,video/*" required>
  <label for="prompt">Optional page prompt</label><textarea id="prompt" name="prompt" aria-describedby="prompt-help"></textarea><p id="prompt-help">File comment, description, and title metadata are used first when present.</p>
  <button type="submit">Upload and generate</button></form><p id="out" aria-live="polite"></p></main>
  <script>document.getElementById("up").addEventListener("submit",async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const out=document.getElementById("out");out.textContent="Uploading…";try{const response=await fetch("/api/upload",{method:"POST",body:form});const data=await response.json();if(!response.ok)throw new Error(data.error||"Upload failed");const link=document.createElement("a");link.href=data.pageUrl;link.textContent="Open “"+data.title+"”";out.replaceChildren("Generated: ",link)}catch(error){out.textContent="Error: "+error.message}});</script></body></html>`;
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export interface HandlerOptions {
  mediaDir?: string;
  publicDir?: string;
}

export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const mediaDir = options.mediaDir ?? DEFAULT_MEDIA_DIR;
  const publicDir = options.publicDir ?? "./public";
  const cache = new Map<string, PageData>();

  const pageFor = async (file: string, prompt?: string): Promise<PageData> => {
    if (!isMediaFilename(file)) {
      throw new Deno.errors.NotFound("media not found");
    }
    const files = await listMedia(mediaDir);
    if (!files.includes(file)) {
      throw new Deno.errors.NotFound("media not found");
    }
    const key = `${file}|${prompt ?? ""}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const data = await generatePage(join(mediaDir, file), prompt);
    data.mediaPath = `/media/${encodeURIComponent(file)}`;
    cache.set(key, data);
    return data;
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (path === "/") {
        return new Response(indexHtml(await listMedia(mediaDir)), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (path.startsWith("/media/")) {
        return await mediaFileResponse(
          mediaDir,
          decodeURIComponent(path.slice("/media/".length)),
          request.headers.get("range"),
        );
      }
      if (path.startsWith("/p/")) {
        const slug = path.slice("/p/".length);
        const file = (await listMedia(mediaDir)).find((candidate) =>
          slugForFile(candidate) === slug
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
      if (path === "/api/page" && request.method === "GET") {
        const file = url.searchParams.get("file");
        if (!file) {
          return cors(
            Response.json({ error: "file param required" }, { status: 400 }),
          );
        }
        return cors(
          Response.json(
            await pageFor(file, url.searchParams.get("prompt") ?? undefined),
          ),
        );
      }
      if (path === "/api/generate" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const file = typeof body.file === "string" ? body.file : "";
        if (!file) {
          return cors(
            Response.json({ error: "file required" }, { status: 400 }),
          );
        }
        const data = await pageFor(
          file,
          typeof body.prompt === "string" ? body.prompt : undefined,
        );
        return cors(
          Response.json({ ok: true, pageUrl: `/p/${data.slug}`, data }),
        );
      }
      if (path === "/api/upload" && request.method === "POST") {
        const form = await request.formData().catch(() => null);
        const upload = form?.get("media");
        if (!(upload instanceof File)) {
          return cors(
            Response.json({ error: "media file required" }, { status: 400 }),
          );
        }
        const name = upload.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        if (
          !isMediaFilename(name) ||
          (!upload.type.startsWith("audio/") &&
            !upload.type.startsWith("video/"))
        ) {
          return cors(
            Response.json({ error: "supported audio or video file required" }, {
              status: 415,
            }),
          );
        }
        await Deno.writeFile(
          join(mediaDir, name),
          new Uint8Array(await upload.arrayBuffer()),
        );
        cache.clear();
        const promptValue = form!.get("prompt");
        const prompt = typeof promptValue === "string" && promptValue.trim()
          ? promptValue.trim()
          : undefined;
        const data = await pageFor(name, prompt);
        return cors(
          Response.json({
            ok: true,
            pageUrl: `/p/${data.slug}`,
            title: data.title,
          }),
        );
      }

      const staticPath = join(publicDir, path.replace(/^\//, ""));
      try {
        const bytes = await Deno.readFile(staticPath);
        return new Response(bytes as BodyInit, {
          headers: { "content-type": contentType(staticPath) },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return cors(
          Response.json({ error: "media not found" }, { status: 404 }),
        );
      }
      console.error(error);
      return cors(
        Response.json({ error: "generation failed" }, { status: 500 }),
      );
    }
  };
}

if (import.meta.main) {
  const mediaDir = Deno.env.get("MEDIA_DIR") ?? DEFAULT_MEDIA_DIR;
  const port = Number(Deno.env.get("PORT") ?? DEFAULT_PORT);
  await Deno.mkdir(mediaDir, { recursive: true });
  serve(createHandler({ mediaDir }), { port });
  console.log(`content-type-gen server on http://localhost:${port}/`);
}
