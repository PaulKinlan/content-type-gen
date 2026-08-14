/// <reference lib="dom" />
import { chromium } from "playwright";
import { join } from "std/path/mod.ts";
import { pageRouteForFile } from "../lib/route.ts";

const root = Deno.cwd();
const artifacts = join(root, "artifacts");
await Deno.mkdir(artifacts, { recursive: true });

// Ask the OS for an available port instead of assuming the developer port is
// ours. The instance nonce below prevents readiness from accepting an unrelated
// process if another listener wins the small close/spawn window.
const allocation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (allocation.addr as Deno.NetAddr).port;
allocation.close();
const baseUrl = `http://127.0.0.1:${port}`;
const instanceId = crypto.randomUUID();
const mediaDir = await Deno.makeTempDir();
await Deno.copyFile("media/voice-memo.mp3", join(mediaDir, "voice-memo.mp3"));
const collidingFiles = ["clip.mp3", "clip.wav", "Clip.mp3", "CLIP.MP3"];
for (const file of collidingFiles) {
  await Deno.copyFile("media/voice-memo.mp3", join(mediaDir, file));
}

const server = new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env=MEDIA_DIR,PORT,SERVER_INSTANCE_ID,BUILD_DATE,PATH,FFPROBE_PATH",
    "server.ts",
  ],
  cwd: root,
  env: {
    ...Deno.env.toObject(),
    MEDIA_DIR: mediaDir,
    PORT: String(port),
    SERVER_INSTANCE_ID: instanceId,
    BUILD_DATE: new Date(0).toISOString(),
  },
  stdout: "piped",
  stderr: "piped",
}).spawn();

async function waitForOwnedServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.instanceId === instanceId) return;
        throw new Error("allocated port is owned by a different server");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "allocated port is owned by a different server"
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("spawned server did not claim its allocated port");
}

const profile = await Deno.makeTempDir();
let context;
try {
  await waitForOwnedServer();
  const extensionPath = join(root, "extension");
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${baseUrl}/`);
  await page.locator("#media-upload").setInputFiles("media/voice-memo.mp3");
  await page.locator("#prompt").fill(
    "Build a seekable research-notes mini-app",
  );
  await page.getByRole("button", { name: "Upload and generate" }).click();
  const generatedLink = page.locator("#out a");
  await generatedLink.waitFor();
  const uploadRoute = await generatedLink.getAttribute("href");
  await generatedLink.click();
  await page.waitForURL(`**/p/${pageRouteForFile("voice-memo-2.mp3")}`);
  await page.locator("#media").evaluate((media: HTMLMediaElement) =>
    media.readyState > 0
      ? undefined
      : new Promise((resolve) =>
        media.addEventListener("loadedmetadata", resolve, { once: true })
      )
  );
  const chapterButtons = page.locator(".chapter");
  const chapterCount = await chapterButtons.count();
  const secondChapter = chapterButtons.nth(1);
  const clickedChapterTime = Number(await secondChapter.getAttribute("data-t"));
  await secondChapter.click();
  await page.waitForFunction((time) => {
    const media = document.querySelector<HTMLMediaElement>("#media");
    return Boolean(media && Math.abs(media.currentTime - Number(time)) < 0.5);
  }, clickedChapterTime);
  const mediaCurrentTime = await page.locator("#media").evaluate((
    media: HTMLMediaElement,
  ) => media.currentTime);
  const activeTranscriptStart = Number(
    await page.locator('.transcript-cue[aria-current="true"]').getAttribute(
      "data-start",
    ),
  );
  const uploadHeading = await page.locator("h1").textContent();
  await page.locator("#media").evaluate((media: HTMLMediaElement, time) => {
    media.pause();
    media.currentTime = Number(time);
  }, clickedChapterTime);
  await page.screenshot({
    path: join(artifacts, "upload-generated.png"),
    fullPage: true,
  });

  const collisionRoutes: Array<{ file: string; route: string; media: string }> =
    [];
  const collisionPage = await context.newPage();
  for (const file of collidingFiles) {
    const route = `/p/${pageRouteForFile(file)}`;
    await collisionPage.goto(`${baseUrl}${route}`);
    const media = await collisionPage.locator("#media").getAttribute("src");
    if (media !== `/media/${encodeURIComponent(file)}`) {
      throw new Error(`${route} rendered ${media} instead of ${file}`);
    }
    collisionRoutes.push({ file, route, media });
  }
  if (new Set(collisionRoutes.map(({ route }) => route)).size !== 4) {
    throw new Error("colliding filenames did not receive distinct routes");
  }
  await collisionPage.close();

  const ogvPage = await context.newPage();
  await ogvPage.goto(`${baseUrl}/`);
  await ogvPage.locator("#media-upload").setInputFiles(
    "tests/fixtures/extensionless-video.ogv",
  );
  await ogvPage.getByRole("button", { name: "Upload and generate" }).click();
  await ogvPage.locator("#out a").click();
  const ogvRoute = `/p/${pageRouteForFile("extensionless-video.ogv")}`;
  await ogvPage.waitForURL(`**${ogvRoute}`);
  const ogvTag = await ogvPage.locator("#media").evaluate((element) =>
    element.tagName.toLowerCase()
  );
  const ogvMedia = await ogvPage.locator("#media").getAttribute("src");
  const ogvResponse = await ogvPage.evaluate(async () => {
    const response = await fetch("/media/extensionless-video.ogv");
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  });
  if (
    ogvTag !== "video" || ogvMedia !== "/media/extensionless-video.ogv" ||
    ogvResponse.status !== 200 || ogvResponse.type !== "video/ogg" ||
    ogvResponse.bytes === 0
  ) {
    throw new Error("OGV browser upload did not roundtrip as video/ogg");
  }
  await ogvPage.close();

  const serviceWorker = context.serviceWorkers()[0] ??
    await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const fixture = await context.newPage();
  await fixture.goto(`${baseUrl}/extension-fixture.html`);
  const extensionControl = fixture.locator("#content-type-gen-root button");
  await extensionControl.waitFor({ timeout: 10_000 });
  const extensionControlText = await extensionControl.textContent();
  // Chromium's native media timeline includes timing-dependent buffered pixels;
  // mask only that native control while retaining the real extension fixture.
  await fixture.screenshot({
    path: join(artifacts, "extension-fixture.png"),
    fullPage: true,
    mask: [fixture.locator("audio")],
    maskColor: "#3b3b3b",
  });
  const extensionPagePromise = context.waitForEvent("page");
  await extensionControl.click();
  const extensionPage = await extensionPagePromise;
  await extensionPage.waitForURL(
    `**/p/${pageRouteForFile("voice-memo-3.mp3")}`,
    { timeout: 15_000 },
  );
  await extensionPage.waitForLoadState("domcontentloaded");
  const extensionHeading = await extensionPage.locator("h1").textContent();

  console.log(JSON.stringify(
    {
      allocatedPort: port,
      ownedServerInstance: instanceId,
      uploadRoute,
      uploadHeading,
      chapterCount,
      clickedChapterTime,
      mediaCurrentTime: Math.round(mediaCurrentTime * 10) / 10,
      activeTranscriptStart,
      collisionRoutes,
      ogvRoute,
      ogvTag,
      ogvMedia,
      ogvResponse,
      extensionServiceWorkerUrl: serviceWorker.url(),
      extensionControlText,
      extensionGeneratedRoute: new URL(extensionPage.url()).pathname,
      extensionHeading,
      extensionUiBoundary:
        "Headless Chromium exercises the content-script control through runGeneration; toolbar/context-menu Chrome UI delegates to that same function but is outside Playwright page automation.",
      screenshots: [
        "artifacts/upload-generated.png",
        "artifacts/extension-fixture.png",
      ],
    },
    null,
    2,
  ));
} finally {
  if (context) await context.close();
  try {
    server.kill("SIGTERM");
  } catch {
    // The server may already have exited after a browser-flow failure.
  }
  await server.status;
  await Deno.remove(profile, { recursive: true });
  await Deno.remove(mediaDir, { recursive: true });
}
