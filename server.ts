// Hosts media, exposes the probe → generate → render pipeline, and accepts
// bounded, verified audio/video uploads that become navigable mini-app pages.
import { serve } from "std/http/server.ts";
import { basename, extname, join } from "std/path/mod.ts";
import { generatePage, PageData } from "./lib/generate.ts";
import { renderPage } from "./lib/page.ts";
import { fileForPageRoute, pageRouteForFile } from "./lib/route.ts";
import {
  FfprobeUnavailableError,
  mediaKind,
  validateMediaFile,
} from "./lib/probe.ts";

const DEFAULT_MEDIA_DIR = "./media";
const DEFAULT_PORT = 8080;
export const MAX_REQUEST_BYTES = 27 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PROMPT_BYTES = 16 * 1024;
export const MEDIA_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".ogv",
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
  ".ogv": "video/ogg",
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

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
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

function rangeNotSatisfiable(length: number, headers: HeadersInit): Response {
  return new Response("range not satisfiable", {
    status: 416,
    headers: {
      ...headers,
      "content-range": `bytes */${length}`,
    },
  });
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

  // Multiple ranges are intentionally ignored rather than partially served.
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) {
    return new Response(bytes as BodyInit, { headers });
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (
      !Number.isSafeInteger(suffixLength) || suffixLength <= 0 || !bytes.length
    ) {
      return rangeNotSatisfiable(bytes.length, headers);
    }
    start = Math.max(0, bytes.length - suffixLength);
    end = bytes.length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : bytes.length - 1;
    if (
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start > end || start >= bytes.length
    ) {
      return rangeNotSatisfiable(bytes.length, headers);
    }
    end = Math.min(end, bytes.length - 1);
  }

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
      pageRouteForFile(file)
    }">${file}</a> <a class="raw" href="/media/${
      encodeURIComponent(file)
    }">(raw)</a></li>`
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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".").map(Number);
  return octets.length === 4 &&
    octets.every((part) =>
      Number.isInteger(part) && part >= 0 && part <= 255
    ) && octets[0] === 127;
}

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.origin === requestUrl.origin ||
      (isLoopbackHostname(originUrl.hostname) &&
        isLoopbackHostname(requestUrl.hostname));
  } catch {
    return false;
  }
}

function isExtensionOrigin(request: Request): boolean {
  return /^chrome-extension:\/\/[^/]+$/.test(
    request.headers.get("origin") ?? "",
  );
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigin(request)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.append("vary", "origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedBody(
  request: Request,
  maximum: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maximum) {
    throw new RequestError(413, "upload request too large");
  }
  if (!request.body) throw new RequestError(400, "multipart body required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new RequestError(413, "upload request too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function safeUploadName(original: string): string | null {
  const extension = extname(original).toLowerCase();
  if (!MEDIA_EXTENSIONS.includes(extension)) return null;
  const rawStem = original.slice(0, -extname(original).length);
  const stem = rawStem.replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 96) || "upload";
  return `${stem}${extension}`;
}

async function persistWithoutOverwrite(
  mediaDir: string,
  tempPath: string,
  requestedName: string,
): Promise<string> {
  const extension = extname(requestedName);
  const stem = requestedName.slice(0, -extension.length);
  for (let sequence = 1; sequence < 10_000; sequence++) {
    const candidate = sequence === 1
      ? requestedName
      : `${stem}-${sequence}${extension}`;
    try {
      await Deno.link(tempPath, join(mediaDir, candidate));
      return candidate;
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) continue;
      throw error;
    }
  }
  throw new RequestError(409, "could not allocate upload filename");
}

export interface HandlerOptions {
  mediaDir?: string;
  publicDir?: string;
  maxRequestBytes?: number;
  maxFileBytes?: number;
  maxPromptBytes?: number;
  instanceId?: string;
  loopbackOnly?: boolean;
  generatedAt?: string;
}

export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const mediaDir = options.mediaDir ?? DEFAULT_MEDIA_DIR;
  const publicDir = options.publicDir ?? "./public";
  const maxRequestBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxPromptBytes = options.maxPromptBytes ?? MAX_PROMPT_BYTES;
  const loopbackOnly = options.loopbackOnly ?? true;
  // A remote page cannot read this same-server capability because its origin is
  // denied. It lets the installed extension make its one privileged mutation
  // without opening state-changing CORS to the web.
  const extensionUploadCapability = crypto.randomUUID();
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
    if (options.generatedAt) data.generatedAt = options.generatedAt;
    cache.set(key, data);
    return data;
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (loopbackOnly && !isLoopbackHostname(url.hostname)) {
      return new Response("loopback host required", { status: 403 });
    }
    const extensionCapabilityRequest = isExtensionOrigin(request) &&
      ((path === "/api/upload-capability" && request.method === "GET") ||
        (path === "/api/upload" && request.method === "POST" &&
          request.headers.get("x-content-type-gen-capability") ===
            extensionUploadCapability));
    if (
      path.startsWith("/api/") && !allowedOrigin(request) &&
      !extensionCapabilityRequest
    ) {
      return Response.json({ error: "origin not allowed" }, { status: 403 });
    }
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      if (!request.headers.get("origin")) {
        return new Response(null, { status: 403 });
      }
      return withCors(request, new Response(null, { status: 204 }));
    }

    try {
      if (path === "/") {
        return new Response(indexHtml(await listMedia(mediaDir)), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (path === "/api/health" && request.method === "GET") {
        return withCors(
          request,
          Response.json({ ok: true, instanceId: options.instanceId ?? null }),
        );
      }
      if (path === "/api/upload-capability" && request.method === "GET") {
        // Privileged extension GETs omit Origin in Chromium. Cross-origin page
        // fetches send Origin and were rejected above, so they cannot read this.
        if (request.headers.get("origin") && !isExtensionOrigin(request)) {
          return Response.json({ error: "extension required" }, {
            status: 403,
          });
        }
        return Response.json({ capability: extensionUploadCapability });
      }
      if (path.startsWith("/media/")) {
        return await mediaFileResponse(
          mediaDir,
          decodeURIComponent(path.slice("/media/".length)),
          request.headers.get("range"),
        );
      }
      if (path.startsWith("/p/")) {
        const file = fileForPageRoute(path.slice("/p/".length));
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
          return withCors(
            request,
            Response.json({ error: "file param required" }, { status: 400 }),
          );
        }
        return withCors(
          request,
          Response.json(
            await pageFor(file, url.searchParams.get("prompt") ?? undefined),
          ),
        );
      }
      if (path === "/api/generate" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const file = typeof body.file === "string" ? body.file : "";
        if (!file) {
          return withCors(
            request,
            Response.json({ error: "file required" }, { status: 400 }),
          );
        }
        const data = await pageFor(
          file,
          typeof body.prompt === "string" ? body.prompt : undefined,
        );
        return withCors(
          request,
          Response.json({ ok: true, pageUrl: `/p/${data.slug}`, data }),
        );
      }
      if (path === "/api/upload" && request.method === "POST") {
        const body = await readBoundedBody(request, maxRequestBytes);
        const formRequest = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: body as BodyInit,
        });
        const form = await formRequest.formData().catch(() => null);
        const upload = form?.get("media");
        if (!(upload instanceof File)) {
          throw new RequestError(400, "media file required");
        }
        if (upload.size > maxFileBytes) {
          throw new RequestError(413, "media file too large");
        }
        const name = safeUploadName(upload.name);
        if (
          !name ||
          (!upload.type.startsWith("audio/") &&
            !upload.type.startsWith("video/"))
        ) {
          throw new RequestError(415, "supported audio or video file required");
        }
        const expectedKind = mediaKind(name)!;
        const promptValue = form!.get("prompt");
        const prompt = typeof promptValue === "string" && promptValue.trim()
          ? promptValue.trim()
          : undefined;
        if (
          prompt && new TextEncoder().encode(prompt).byteLength > maxPromptBytes
        ) {
          throw new RequestError(413, "prompt too large");
        }

        const tempPath = join(
          mediaDir,
          `.upload-${crypto.randomUUID()}.tmp`,
        );
        let persistedName: string | null = null;
        try {
          await Deno.writeFile(
            tempPath,
            new Uint8Array(await upload.arrayBuffer()),
            { createNew: true },
          );
          if (!await validateMediaFile(tempPath, expectedKind)) {
            throw new RequestError(415, "file content is not valid media");
          }
          persistedName = await persistWithoutOverwrite(
            mediaDir,
            tempPath,
            name,
          );
          cache.clear();
          const data = await pageFor(persistedName, prompt);
          return withCors(
            request,
            Response.json({
              ok: true,
              pageUrl: `/p/${data.slug}`,
              title: data.title,
              file: persistedName,
            }),
          );
        } catch (error) {
          if (persistedName) {
            await Deno.remove(join(mediaDir, persistedName)).catch(() => {});
            cache.clear();
          }
          throw error;
        } finally {
          await Deno.remove(tempPath).catch(() => {});
        }
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
      if (error instanceof RequestError) {
        return withCors(
          request,
          Response.json({ error: error.message }, { status: error.status }),
        );
      }
      if (error instanceof FfprobeUnavailableError) {
        return withCors(
          request,
          Response.json({ error: error.message }, { status: 503 }),
        );
      }
      if (error instanceof Deno.errors.NotFound) {
        return withCors(
          request,
          Response.json({ error: "media not found" }, { status: 404 }),
        );
      }
      console.error(error);
      return withCors(
        request,
        Response.json({ error: "generation failed" }, { status: 500 }),
      );
    }
  };
}

if (import.meta.main) {
  const mediaDir = Deno.env.get("MEDIA_DIR") ?? DEFAULT_MEDIA_DIR;
  const port = Number(Deno.env.get("PORT") ?? DEFAULT_PORT);
  const instanceId = Deno.env.get("SERVER_INSTANCE_ID") ?? undefined;
  const generatedAt = Deno.env.get("BUILD_DATE") ?? undefined;
  await Deno.mkdir(mediaDir, { recursive: true });
  serve(createHandler({ mediaDir, instanceId, generatedAt }), {
    hostname: "127.0.0.1",
    port,
  });
  console.log(`content-type-gen server on http://127.0.0.1:${port}/`);
}
