import { assert, assertEquals } from "std/assert/mod.ts";
import { createHandler } from "../server.ts";

async function fixtureHandler() {
  const mediaDir = await Deno.makeTempDir();
  await Deno.copyFile("media/voice-memo.mp3", `${mediaDir}/voice-memo.mp3`);
  return { mediaDir, handler: createHandler({ mediaDir }) };
}

Deno.test("server renders pages, JSON, and byte ranges", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const index = await handler(new Request("http://test/"));
    assertEquals(index.status, 200);
    assert((await index.text()).includes("voice-memo.mp3"));

    const page = await handler(new Request("http://test/p/voice-memo"));
    const html = await page.text();
    assertEquals(page.status, 200);
    assert(html.includes("Voice memo: offline-first ideas"));
    assert(html.includes("transcript-cue"));

    const json = await handler(
      new Request("http://test/api/page?file=voice-memo.mp3"),
    );
    assertEquals(json.status, 200);
    assertEquals((await json.json()).kind, "audio");

    const range = await handler(
      new Request("http://test/media/voice-memo.mp3", {
        headers: { range: "bytes=0-99" },
      }),
    );
    assertEquals(range.status, 206);
    assertEquals((await range.arrayBuffer()).byteLength, 100);
    assert(range.headers.get("content-range")?.startsWith("bytes 0-99/"));
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("upload hosts an MP3 and returns its working route", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    const form = new FormData();
    form.append(
      "media",
      new File([bytes], "uploaded-demo.mp3", { type: "audio/mpeg" }),
    );
    form.append("prompt", "Build a chapter-led field notes app");
    const upload = await handler(
      new Request("http://test/api/upload", { method: "POST", body: form }),
    );
    const result = await upload.json();
    assertEquals(upload.status, 200);
    assertEquals(result.pageUrl, "/p/uploaded-demo");

    const page = await handler(new Request(`http://test${result.pageUrl}`));
    assertEquals(page.status, 200);
    assert((await page.text()).includes('<audio id="media"'));
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("server rejects traversal, absent media, and non-media uploads", async () => {
  const { mediaDir, handler } = await fixtureHandler();
  try {
    assertEquals(
      (await handler(new Request("http://test/api/page?file=../server.ts")))
        .status,
      404,
    );
    assertEquals(
      (await handler(new Request("http://test/api/page?file=missing.mp3")))
        .status,
      404,
    );
    const form = new FormData();
    form.append(
      "media",
      new File(["nope"], "notes.txt", { type: "text/plain" }),
    );
    assertEquals(
      (await handler(
        new Request("http://test/api/upload", { method: "POST", body: form }),
      )).status,
      415,
    );
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});
