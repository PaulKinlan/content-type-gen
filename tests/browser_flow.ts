/// <reference lib="dom" />
import { chromium } from "playwright";
import { join } from "std/path/mod.ts";
import { pageRouteForFile } from "../lib/route.ts";

const root = Deno.cwd();
const artifacts = join(root, "artifacts");
const pagesDirectory = join(root, "docs");
const pagesPrefix = "/content-type-gen/";
await Deno.mkdir(artifacts, { recursive: true });

async function collectHtmlFiles(
  directory: string,
  relativeDirectory = "",
): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(join(directory, relativeDirectory))) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory) {
      files.push(...await collectHtmlFiles(directory, relativePath));
    } else if (entry.isFile && entry.name.endsWith(".html")) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function scanStaticLinks(directory: string, prefix: string) {
  const htmlFiles = await collectHtmlFiles(directory);
  const checked: Array<{ page: string; attribute: string; value: string }> = [];
  const origin = "https://pages.example";
  for (const htmlFile of htmlFiles) {
    const html = await Deno.readTextFile(join(directory, htmlFile));
    for (
      const match of html.matchAll(/\b(href|src)\s*=\s*(["'])(.*?)\2/gi)
    ) {
      const [, attribute, , value] = match;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
      const resolved = new URL(value, `${origin}${prefix}${htmlFile}`);
      if (resolved.origin !== origin || !resolved.pathname.startsWith(prefix)) {
        throw new Error(
          `${htmlFile} ${attribute}=${JSON.stringify(value)} escapes ${prefix}`,
        );
      }
      const targetFromPrefix = decodeURIComponent(
        resolved.pathname.slice(prefix.length),
      );
      const target = !targetFromPrefix || targetFromPrefix.endsWith("/")
        ? `${targetFromPrefix}index.html`
        : targetFromPrefix;
      let targetInfo: Deno.FileInfo;
      try {
        targetInfo = await Deno.stat(join(directory, target));
      } catch {
        throw new Error(
          `${htmlFile} ${attribute}=${JSON.stringify(value)} has no target`,
        );
      }
      if (!targetInfo.isFile) {
        throw new Error(
          `${htmlFile} ${attribute}=${JSON.stringify(value)} is not a file`,
        );
      }
      if (resolved.hash && target.endsWith(".html")) {
        const fragment = decodeURIComponent(resolved.hash.slice(1));
        const targetHtml = await Deno.readTextFile(join(directory, target));
        if (
          !targetHtml.includes(`id="${fragment}"`) &&
          !targetHtml.includes(`id='${fragment}'`)
        ) {
          throw new Error(
            `${htmlFile} ${attribute}=${
              JSON.stringify(value)
            } has no fragment target`,
          );
        }
      }
      checked.push({ page: htmlFile, attribute, value });
    }
  }
  return { htmlFiles, checked };
}

const staticLinkScan = await scanStaticLinks(pagesDirectory, pagesPrefix);
const pagesServer = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(pagesPrefix)) {
      return new Response("not found", { status: 404 });
    }
    const fromPrefix = decodeURIComponent(
      url.pathname.slice(pagesPrefix.length),
    );
    const relativePath = !fromPrefix || fromPrefix.endsWith("/")
      ? `${fromPrefix}index.html`
      : fromPrefix;
    try {
      const bytes = await Deno.readFile(join(pagesDirectory, relativePath));
      const type = relativePath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : relativePath.endsWith(".mp3")
        ? "audio/mpeg"
        : relativePath.endsWith(".mp4")
        ? "video/mp4"
        : "application/octet-stream";
      return new Response(bytes as BodyInit, {
        headers: { "content-type": type },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
);
const pagesBaseUrl = `http://127.0.0.1:${
  (pagesServer.addr as Deno.NetAddr).port
}`;

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

  const staticPage = await context.newPage();
  const staticGeneratedUrl = `${pagesBaseUrl}${pagesPrefix}${
    pageRouteForFile("voice-memo.mp3")
  }.html`;
  await staticPage.goto(staticGeneratedUrl);
  const staticRelatedLinks = staticPage.locator("a.related");
  if (await staticRelatedLinks.count() !== 2) {
    throw new Error("static generated page did not render both related links");
  }
  await staticPage.getByRole("link", { name: "How it was generated" }).click();
  await staticPage.waitForURL(`${pagesBaseUrl}${pagesPrefix}#how`);
  const howUrl = new URL(staticPage.url());
  if (
    howUrl.pathname !== pagesPrefix || howUrl.hash !== "#how" ||
    await staticPage.locator("#how").count() !== 1
  ) {
    throw new Error("How it was generated escaped the Pages project prefix");
  }
  await staticPage.screenshot({
    path: join(artifacts, "pages-related-how.png"),
    fullPage: true,
  });

  await staticPage.goto(staticGeneratedUrl);
  await staticPage.getByRole("link", { name: "All media" }).click();
  await staticPage.waitForURL(`${pagesBaseUrl}${pagesPrefix}`);
  const allMediaUrl = new URL(staticPage.url());
  if (
    allMediaUrl.pathname !== pagesPrefix || allMediaUrl.hash ||
    await staticPage.getByRole("heading", { name: "content-type-gen" })
        .count() !==
      1
  ) {
    throw new Error("All media escaped the Pages project prefix");
  }
  await staticPage.screenshot({
    path: join(artifacts, "pages-related-all-media.png"),
    fullPage: true,
  });
  await staticPage.close();

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
      staticPages: {
        prefix: pagesPrefix,
        generatedUrl: staticGeneratedUrl,
        howDestination: `${howUrl.pathname}${howUrl.hash}`,
        allMediaDestination: allMediaUrl.pathname,
        scannedHtmlFiles: staticLinkScan.htmlFiles,
        checkedHrefAndSrcCount: staticLinkScan.checked.length,
      },
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
        "artifacts/pages-related-how.png",
        "artifacts/pages-related-all-media.png",
      ],
    },
    null,
    2,
  ));
} finally {
  if (context) await context.close();
  await pagesServer.shutdown();
  try {
    server.kill("SIGTERM");
  } catch {
    // The server may already have exited after a browser-flow failure.
  }
  await server.status;
  await Deno.remove(profile, { recursive: true });
  await Deno.remove(mediaDir, { recursive: true });
}
