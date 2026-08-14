/// <reference lib="dom" />
import { chromium } from "playwright";
import { join } from "std/path/mod.ts";

const root = Deno.cwd();
const artifacts = join(root, "artifacts");
await Deno.mkdir(artifacts, { recursive: true });
const server = new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    "server.ts",
  ],
  cwd: root,
  env: { ...Deno.env.toObject(), PORT: "8080" },
  stdout: "piped",
  stderr: "piped",
}).spawn();

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8080/");
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

const profile = await Deno.makeTempDir();
let context;
try {
  await waitForServer();
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
  await page.goto("http://127.0.0.1:8080/");
  await page.locator("#media-upload").setInputFiles("media/voice-memo.mp3");
  await page.locator("#prompt").fill(
    "Build a seekable research-notes mini-app",
  );
  await page.getByRole("button", { name: "Upload and generate" }).click();
  const generatedLink = page.locator("#out a");
  await generatedLink.waitFor();
  const uploadRoute = await generatedLink.getAttribute("href");
  await generatedLink.click();
  await page.waitForURL("**/p/voice-memo");
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
  await page.screenshot({
    path: join(artifacts, "upload-generated.png"),
    fullPage: true,
  });

  const serviceWorker = context.serviceWorkers()[0] ??
    await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const fixture = await context.newPage();
  await fixture.goto("http://127.0.0.1:8080/extension-fixture.html");
  const extensionControl = fixture.locator("#content-type-gen-root button");
  await extensionControl.waitFor({ timeout: 10_000 });
  const extensionControlText = await extensionControl.textContent();
  await fixture.screenshot({
    path: join(artifacts, "extension-fixture.png"),
    fullPage: true,
  });
  const extensionPagePromise = context.waitForEvent("page");
  await extensionControl.click();
  const extensionPage = await extensionPagePromise;
  await extensionPage.waitForURL("**/p/voice-memo", { timeout: 15_000 });
  await extensionPage.waitForLoadState("domcontentloaded");
  const extensionHeading = await extensionPage.locator("h1").textContent();

  console.log(JSON.stringify(
    {
      uploadRoute,
      uploadHeading,
      chapterCount,
      clickedChapterTime,
      mediaCurrentTime: Math.round(mediaCurrentTime * 10) / 10,
      activeTranscriptStart,
      extensionServiceWorkerUrl: serviceWorker.url(),
      extensionControlText,
      extensionGeneratedRoute: new URL(extensionPage.url()).pathname,
      extensionHeading,
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
}
