import { assert, assertEquals, assertGreater } from "std/assert/mod.ts";
import { FAVICON_HREF } from "../lib/favicon.ts";
import { generatePage } from "../lib/generate.ts";
import { renderPage } from "../lib/page.ts";
import {
  ffprobeExecutable,
  mediaKind,
  probeMedia,
  validateMediaFile,
} from "../lib/probe.ts";
import { fileForPageRoute, pageRouteForFile } from "../lib/route.ts";

Deno.test("probe reads ffprobe media metadata", async () => {
  assertEquals(
    ffprobeExecutable(" /opt/media tools/ffprobe "),
    "/opt/media tools/ffprobe",
  );
  assertEquals(ffprobeExecutable(""), "ffprobe");
  assertEquals(mediaKind("memo.MP3"), "audio");
  assertEquals(mediaKind("talk.mp4"), "video");
  assertEquals(mediaKind("extensionless-video.ogv"), "video");
  assertEquals(mediaKind("notes.txt"), null);
  const probe = await probeMedia("media/voice-memo.mp3");
  assertEquals(probe.kind, "audio");
  assertGreater(probe.durationSec, 11);
  assertEquals(probe.metadataTitle, "Voice memo: offline-first ideas");
  assert(probe.metadataPrompt?.includes("to-do list app"));
  assertEquals(await validateMediaFile("media/voice-memo.mp3", "audio"), true);
  assertEquals(await validateMediaFile("media/voice-memo.mp3", "video"), false);
});

Deno.test("generator returns every page field without an external AI", async () => {
  const page = await generatePage("media/voice-memo.mp3");
  assertEquals(page.slug, pageRouteForFile("voice-memo.mp3"));
  assertEquals(page.title, "Voice memo: offline-first ideas");
  assert(page.description.includes("to-do list app"));
  assertEquals(page.chapters.length, 2);
  assertEquals(page.transcriptCues.length, page.chapters.length);
  assert(page.transcript.includes("to-do list app"));
  assertEquals(page.related, [
    { label: "How it was generated", href: "/#how" },
    { label: "All media", href: "/" },
  ]);
});

Deno.test("page routes preserve complete filename identity", () => {
  const files = ["clip.mp3", "clip.wav", "Clip.mp3", "CLIP.MP3", "café.ogg"];
  const routes = files.map(pageRouteForFile);
  assertEquals(new Set(routes).size, files.length);
  assertEquals(routes.map(fileForPageRoute), files);
  assertEquals(fileForPageRoute("not+a+route"), null);
});

Deno.test("pregeneration keeps colliding stems in distinct output files", async () => {
  const mediaDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const files = ["clip.mp3", "clip.wav", "Clip.mp3", "CLIP.MP3"];
  try {
    const bytes = await Deno.readFile("media/voice-memo.mp3");
    for (const file of files) {
      await Deno.writeFile(`${mediaDir}/${file}`, bytes);
    }
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env=MEDIA_DIR,OUT_DIR,MEDIA_BASE,COPY_MEDIA,BUILD_DATE,SITE_BASE,PATH,FFPROBE_PATH",
        "scripts/generate.ts",
      ],
      env: {
        MEDIA_DIR: mediaDir,
        OUT_DIR: outputDir,
        MEDIA_BASE: "../media",
        COPY_MEDIA: "0",
        BUILD_DATE: new Date(0).toISOString(),
      },
      stdout: "piped",
      stderr: "piped",
    });
    const result = await command.output();
    assertEquals(
      result.success,
      true,
      new TextDecoder().decode(result.stderr),
    );
    for (const file of files) {
      const html = await Deno.readTextFile(
        `${outputDir}/${pageRouteForFile(file)}.html`,
      );
      assert(html.includes(`src="../media/${encodeURIComponent(file)}"`));
      assert(html.includes(`rel="icon" href="${FAVICON_HREF}"`));
      assert(html.includes('href="./#how"'));
      assert(html.includes('href="./"'));
    }
    const index = await Deno.readTextFile(`${outputDir}/index.html`);
    assert(index.includes(`rel="icon" href="${FAVICON_HREF}"`));
    assert(index.includes('<section id="how">'));
    await Deno.stat(`${outputDir}/clip.html`).then(
      () => {
        throw new Error("legacy normalized route was generated");
      },
      (error) => assert(error instanceof Deno.errors.NotFound),
    );
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("provider seam can enrich generated data", async () => {
  const page = await generatePage(
    "media/voice-memo.mp3",
    undefined,
    (data, probe) => ({
      ...data,
      title: `Enriched ${probe.kind}`,
    }),
    "/preview/content-type-gen/",
  );
  assertEquals(page.title, "Enriched audio");
  assertEquals(page.related, [
    {
      label: "How it was generated",
      href: "/preview/content-type-gen/#how",
    },
    { label: "All media", href: "/preview/content-type-gen/" },
  ]);
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
  assert(html.includes(`rel="icon" href="${FAVICON_HREF}"`));
  assert(html.includes('class="chapter"'));
  assert(html.includes('class="transcript-cue"'));
  assert(html.includes('aria-current="true"'));
  assert(html.includes('addEventListener("timeupdate"'));
});
