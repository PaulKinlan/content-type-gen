import { assert, assertEquals, assertMatch } from "std/assert/mod.ts";
import { fileNameFor } from "../extension/file-name.js";
import { pageRouteForFile } from "../lib/route.ts";
import { createHandler } from "../server.ts";

const BASE = "http://127.0.0.1:8080";

async function fixtureHandler(
  options: Parameters<typeof createHandler>[0] = {},
) {
  const mediaDir = await Deno.makeTempDir();
  await Deno.copyFile("media/voice-memo.mp3", `${mediaDir}/voice-memo.mp3`);
  return {
    mediaDir,
    handler: createHandler({ mediaDir, ...options }),
  };
}

function uploadRequest(
  bytes: BlobPart,
  name = "uploaded-demo.mp3",
  type = "audio/mpeg",
  prompt?: string,
  headers?: HeadersInit,
): Request {
  const form = new FormData();
  form.append("media", new File([bytes], name, { type }));
  if (prompt !== undefined) form.append("prompt", prompt);
  return new Request(`${BASE}/api/upload`, {
    method: "POST",
    body: form,
    headers,
  });
}

Deno.test("server renders pages and JSON", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const index = await handler(new Request(`${BASE}/`));
    assertEquals(index.status, 200);
    assert((await index.text()).includes("voice-memo.mp3"));

    const page = await handler(
      new Request(`${BASE}/p/${pageRouteForFile("voice-memo.mp3")}`),
    );
    const html = await page.text();
    assertEquals(page.status, 200);
    assert(html.includes("Voice memo: offline-first ideas"));
    assert(html.includes("transcript-cue"));

    const json = await handler(
      new Request(`${BASE}/api/page?file=voice-memo.mp3`),
    );
    assertEquals(json.status, 200);
    assertEquals((await json.json()).kind, "audio");
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("page routes cannot collide across extensions or filename case", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  const files = ["clip.mp3", "clip.wav", "Clip.mp3", "CLIP.MP3"];
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    for (const file of files) {
      await Deno.writeFile(`${mediaDir}/${file}`, bytes);
    }

    const index = await (await handler(new Request(`${BASE}/`))).text();
    for (const file of files) {
      const route = pageRouteForFile(file);
      assert(index.includes(`href="/p/${route}">${file}</a>`));
      const response = await handler(new Request(`${BASE}/p/${route}`));
      assertEquals(response.status, 200);
      const html = await response.text();
      assert(html.includes(`src="/media/${encodeURIComponent(file)}"`));
    }

    assertEquals(new Set(files.map(pageRouteForFile)).size, files.length);
    assertEquals(
      (await handler(new Request(`${BASE}/p/not+a+valid+route`))).status,
      404,
    );
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("media supports closed, open, and suffix ranges", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    const requestRange = (range: string) =>
      handler(
        new Request(`${BASE}/media/voice-memo.mp3`, { headers: { range } }),
      );

    const closed = await requestRange("bytes=10-19");
    assertEquals(closed.status, 206);
    assertEquals(
      new Uint8Array(await closed.arrayBuffer()),
      bytes.slice(10, 20),
    );
    assertEquals(
      closed.headers.get("content-range"),
      `bytes 10-19/${bytes.length}`,
    );

    const open = await requestRange(`bytes=${bytes.length - 12}-`);
    assertEquals(open.status, 206);
    assertEquals(new Uint8Array(await open.arrayBuffer()), bytes.slice(-12));

    const suffix = await requestRange("bytes=-9");
    assertEquals(suffix.status, 206);
    assertEquals(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(-9));
    assertEquals(
      suffix.headers.get("content-range"),
      `bytes ${bytes.length - 9}-${bytes.length - 1}/${bytes.length}`,
    );

    const oversizedSuffix = await requestRange(`bytes=-${bytes.length + 50}`);
    assertEquals(oversizedSuffix.status, 206);
    assertEquals(
      (await oversizedSuffix.arrayBuffer()).byteLength,
      bytes.length,
    );

    for (
      const value of [
        `bytes=${bytes.length}-`,
        "bytes=20-10",
        "bytes=-0",
      ]
    ) {
      const response = await requestRange(value);
      assertEquals(response.status, 416);
      assertEquals(
        response.headers.get("content-range"),
        `bytes */${bytes.length}`,
      );
    }

    // Invalid syntax and unsupported multiple ranges may be ignored per RFC 9110.
    assertEquals((await requestRange("items=0-2")).status, 200);
    assertEquals((await requestRange("bytes=0-2,5-7")).status, 200);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("upload validates and hosts an MP3", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    const upload = await handler(
      uploadRequest(bytes, "uploaded-demo.mp3", "audio/mpeg", "Field notes"),
    );
    const result = await upload.json();
    assertEquals(upload.status, 200);
    assertEquals(result.pageUrl, `/p/${pageRouteForFile(result.file)}`);
    assertEquals(result.file, "uploaded-demo.mp3");

    const page = await handler(new Request(`${BASE}${result.pageUrl}`));
    assertEquals(page.status, 200);
    assert((await page.text()).includes('<audio id="media"'));
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("extensionless video/ogg upload roundtrips as supported OGV", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const extensionResponse = new Response(null, {
      headers: { "content-type": "video/ogg" },
    });
    const file = fileNameFor(
      extensionResponse,
      "https://media.example/extensionless-video",
    );
    assertEquals(file, "extensionless-video.ogv");

    const bytes = await Deno.readFile(
      "tests/fixtures/extensionless-video.ogv",
    );
    const response = await handler(
      uploadRequest(bytes, file, "video/ogg"),
    );
    const result = await response.json();
    assertEquals(response.status, 200);
    assertEquals(result.file, file);
    assertEquals(result.pageUrl, `/p/${pageRouteForFile(file)}`);

    const page = await handler(new Request(`${BASE}${result.pageUrl}`));
    assertEquals(page.status, 200);
    const html = await page.text();
    assert(html.includes('<video id="media"'));
    assert(html.includes(`src="/media/${file}"`));

    const media = await handler(new Request(`${BASE}/media/${file}`));
    assertEquals(media.status, 200);
    assertEquals(media.headers.get("content-type"), "video/ogg");
    assertEquals(new Uint8Array(await media.arrayBuffer()), bytes);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("upload never overwrites a colliding media filename", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const original = await Deno.readFile(`${mediaDir}/voice-memo.mp3`);
    const response = await handler(
      uploadRequest(original, "voice-memo.mp3"),
    );
    const result = await response.json();
    assertEquals(response.status, 200);
    assertEquals(result.file, "voice-memo-2.mp3");
    assertEquals(result.pageUrl, `/p/${pageRouteForFile(result.file)}`);
    assertEquals(await Deno.readFile(`${mediaDir}/voice-memo.mp3`), original);
    assertEquals(await Deno.readFile(`${mediaDir}/voice-memo-2.mp3`), original);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("fake media rejects without persistence and cleans temporary files", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const response = await handler(
      uploadRequest("plain text is not an mp3", "fake.mp3", "audio/mpeg"),
    );
    assertEquals(response.status, 415);
    assertMatch((await response.json()).error, /not valid media/);
    const names = [];
    for await (const entry of Deno.readDir(mediaDir)) names.push(entry.name);
    assertEquals(names.sort(), ["voice-memo.mp3"]);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("multipart request, media file, and prompt limits are enforced", async () => {
  const bytes = await Deno.readFile("media/voice-memo.mp3");

  const requestFixture = await fixtureHandler({ maxRequestBytes: 100 });
  try {
    const response = await requestFixture.handler(uploadRequest(bytes));
    assertEquals(response.status, 413);
    assertMatch((await response.json()).error, /request too large/);
  } finally {
    await Deno.remove(requestFixture.mediaDir, { recursive: true });
  }

  const fileFixture = await fixtureHandler({
    maxRequestBytes: bytes.length + 10_000,
    maxFileBytes: bytes.length - 1,
  });
  try {
    const response = await fileFixture.handler(uploadRequest(bytes));
    assertEquals(response.status, 413);
    assertMatch((await response.json()).error, /file too large/);
  } finally {
    await Deno.remove(fileFixture.mediaDir, { recursive: true });
  }

  const promptFixture = await fixtureHandler({
    maxRequestBytes: bytes.length + 10_000,
    maxPromptBytes: 4,
  });
  try {
    const response = await promptFixture.handler(
      uploadRequest(bytes, "prompt.mp3", "audio/mpeg", "12345"),
    );
    assertEquals(response.status, 413);
    assertMatch((await response.json()).error, /prompt too large/);
    const names = [];
    for await (const entry of Deno.readDir(promptFixture.mediaDir)) {
      names.push(entry.name);
    }
    assertEquals(names, ["voice-memo.mp3"]);
  } finally {
    await Deno.remove(promptFixture.mediaDir, { recursive: true });
  }
});

Deno.test("API CORS permits loopback origins without wildcarding mutations", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    const allowed = await handler(
      uploadRequest(bytes, "cors.mp3", "audio/mpeg", undefined, {
        origin: "http://localhost:3000",
      }),
    );
    assertEquals(allowed.status, 200);
    assertEquals(
      allowed.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
    assertEquals(
      allowed.headers.get("access-control-allow-origin")?.includes("*"),
      false,
    );

    const capabilityResponse = await handler(
      new Request(`${BASE}/api/upload-capability`),
    );
    assertEquals(capabilityResponse.status, 200);
    const { capability } = await capabilityResponse.json();
    const extensionUpload = await handler(
      uploadRequest(bytes, "extension.mp3", "audio/mpeg", undefined, {
        origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "x-content-type-gen-capability": capability,
      }),
    );
    assertEquals(extensionUpload.status, 200);
    assertEquals(
      extensionUpload.headers.get("access-control-allow-origin"),
      null,
    );

    const denied = await handler(
      uploadRequest(bytes, "foreign.mp3", "audio/mpeg", undefined, {
        origin: "https://attacker.example",
      }),
    );
    assertEquals(denied.status, 403);
    assertEquals(denied.headers.get("access-control-allow-origin"), null);
    await Deno.stat(`${mediaDir}/foreign.mp3`).then(
      () => {
        throw new Error("foreign-origin upload persisted");
      },
      (error) => assert(error instanceof Deno.errors.NotFound),
    );

    const wrongHost = await handler(new Request("http://example.test/"));
    assertEquals(wrongHost.status, 403);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("server rejects traversal, absent media, and non-media uploads", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    assertEquals(
      (await handler(new Request(`${BASE}/api/page?file=../server.ts`))).status,
      404,
    );
    assertEquals(
      (await handler(new Request(`${BASE}/api/page?file=missing.mp3`))).status,
      404,
    );
    assertEquals(
      (await handler(uploadRequest("nope", "notes.txt", "text/plain"))).status,
      415,
    );
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});
