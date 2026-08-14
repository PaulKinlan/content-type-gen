import { assert, assertEquals, assertGreater } from "std/assert/mod.ts";
import { generatePage } from "../lib/generate.ts";
import { renderPage } from "../lib/page.ts";
import { mediaKind, probeMedia } from "../lib/probe.ts";

Deno.test("probe reads ffprobe media metadata", async () => {
  assertEquals(mediaKind("memo.MP3"), "audio");
  assertEquals(mediaKind("talk.mp4"), "video");
  assertEquals(mediaKind("notes.txt"), null);
  const probe = await probeMedia("media/voice-memo.mp3");
  assertEquals(probe.kind, "audio");
  assertGreater(probe.durationSec, 11);
  assertEquals(probe.metadataTitle, "Voice memo: offline-first ideas");
  assert(probe.metadataPrompt?.includes("to-do list app"));
});

Deno.test("generator returns every page field without an external AI", async () => {
  const page = await generatePage("media/voice-memo.mp3");
  assertEquals(page.slug, "voice-memo");
  assertEquals(page.title, "Voice memo: offline-first ideas");
  assert(page.description.includes("to-do list app"));
  assertEquals(page.chapters.length, 2);
  assertEquals(page.transcriptCues.length, page.chapters.length);
  assert(page.transcript.includes("to-do list app"));
  assertEquals(page.related.length, 2);
});

Deno.test("provider seam can enrich generated data", async () => {
  const page = await generatePage(
    "media/voice-memo.mp3",
    undefined,
    (data, probe) => ({
      ...data,
      title: `Enriched ${probe.kind}`,
    }),
  );
  assertEquals(page.title, "Enriched audio");
});

Deno.test("renderer escapes prompts and wires seek and transcript highlighting", async () => {
  const page = await generatePage(
    "media/voice-memo.mp3",
    undefined,
    (data) => ({
      ...data,
      title: `<unsafe>`,
    }),
  );
  const html = renderPage(page);
  assert(html.includes("&lt;unsafe&gt;"));
  assert(!html.includes("<unsafe>"));
  assert(html.includes('class="chapter"'));
  assert(html.includes('class="transcript-cue"'));
  assert(html.includes('aria-current="true"'));
  assert(html.includes('addEventListener("timeupdate"'));
});
