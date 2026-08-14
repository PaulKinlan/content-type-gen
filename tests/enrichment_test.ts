import { assert, assertEquals, assertMatch } from "std/assert/mod.ts";
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  geminiEnricher,
  MAX_ENRICHED_CHAPTER_LABEL_LENGTH,
  MAX_ENRICHED_CHAPTERS,
  MAX_ENRICHED_DESCRIPTION_LENGTH,
  MAX_ENRICHED_TITLE_LENGTH,
  MAX_METADATA_BYTES,
} from "../lib/enrich-gemini.ts";
import { type PageData } from "../lib/generate.ts";
import { type MediaProbe } from "../lib/probe.ts";
import { createHandler } from "../server.ts";

const BASE = "http://127.0.0.1:8080";
const API_KEY = "mock-api-key-not-a-credential";
const OWNER_TOKEN = "mock-owner-token-not-a-credential";

const probe: MediaProbe = {
  path: `/media/${"m".repeat(20_000)}.mp3`,
  kind: "audio",
  durationSec: 60,
  width: null,
  height: null,
  codec: "mp3",
  container: "mp3",
  sizeBytes: 100,
  metadataTitle: null,
  metadataPrompt: null,
};

const page: PageData = {
  durationSec: 60,
  slug: "media",
  mediaPath: "/media/media.mp3",
  kind: "audio",
  title: "Offline title",
  description: "Offline description",
  chapters: [{ t: 0, label: "Offline chapter" }],
  transcript: "Transcript",
  transcriptCues: [],
  related: [],
  sourcePrompt: "p".repeat(20_000),
  generatedAt: new Date(0).toISOString(),
};

function geminiResponse(output: unknown): Response {
  return Response.json({
    candidates: [{
      content: { parts: [{ text: JSON.stringify(output) }] },
    }],
  });
}

Deno.test("Gemini uses a fixed header-authenticated bounded request and output", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(input);
    calledInit = init;
    return Promise.resolve(geminiResponse({
      title: "T".repeat(MAX_ENRICHED_TITLE_LENGTH + 50),
      description: "D".repeat(MAX_ENRICHED_DESCRIPTION_LENGTH + 50),
      chapters: Array.from(
        { length: MAX_ENRICHED_CHAPTERS + 5 },
        (_, index) => ({
          t: index * 4,
          label: "L".repeat(MAX_ENRICHED_CHAPTER_LABEL_LENGTH + 50),
        }),
      ),
    }));
  }) as typeof fetch;

  const result = await geminiEnricher({ apiKey: API_KEY, fetcher })(
    page,
    probe,
  );
  assertEquals(calledUrl.includes(API_KEY), false);
  assertEquals(new URL(calledUrl).search, "");
  const headers = new Headers(calledInit?.headers);
  assertEquals(headers.get("x-goog-api-key"), API_KEY);
  assertEquals(headers.get("authorization"), null);
  const body = JSON.parse(String(calledInit?.body));
  assertEquals(
    body.generationConfig.maxOutputTokens,
    GEMINI_MAX_OUTPUT_TOKENS,
  );
  const sentPrompt = body.contents[0].parts[0].text as string;
  assert(
    new TextEncoder().encode(sentPrompt).byteLength < MAX_METADATA_BYTES + 700,
  );
  assertEquals(result.title.length, MAX_ENRICHED_TITLE_LENGTH);
  assertEquals(result.description.length, MAX_ENRICHED_DESCRIPTION_LENGTH);
  assertEquals(result.chapters.length, MAX_ENRICHED_CHAPTERS);
  assert(
    result.chapters.every((chapter) =>
      chapter.label.length === MAX_ENRICHED_CHAPTER_LABEL_LENGTH &&
      chapter.t <= probe.durationSec
    ),
  );
});

Deno.test("Gemini timeout and oversized response fall back without leaking", async () => {
  let observedAbort = false;
  const hangingFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        observedAbort = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }) as typeof fetch;
  const timedOut = await geminiEnricher({
    apiKey: API_KEY,
    fetcher: hangingFetch,
    timeoutMs: 5,
  })(page, probe);
  assert(observedAbort);
  assertEquals(timedOut, page);

  const oversizedFetch = (() =>
    Promise.resolve(
      new Response("x".repeat(65), {
        headers: { "content-length": "65" },
      }),
    )) as typeof fetch;
  const oversized = await geminiEnricher({
    apiKey: API_KEY,
    fetcher: oversizedFetch,
    maxResponseBytes: 64,
  })(page, probe);
  assertEquals(oversized, page);
});

async function handlerFixture(fetcher: typeof fetch) {
  const mediaDir = await Deno.makeTempDir();
  await Deno.copyFile("media/voice-memo.mp3", `${mediaDir}/voice-memo.mp3`);
  return {
    mediaDir,
    handler: createHandler({
      mediaDir,
      generatedAt: new Date(0).toISOString(),
      enrichment: {
        enabled: true,
        token: OWNER_TOKEN,
        apiKey: API_KEY,
        fetcher,
      },
    }),
  };
}

function jsonRequest(
  path: string,
  body: unknown,
  token = OWNER_TOKEN,
): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("owner enrichment is POST-only, gated, authenticated, and isolated", async () => {
  let fetchCalls = 0;
  const fetcher = (() => {
    fetchCalls++;
    return Promise.resolve(geminiResponse({ title: "Owner enriched" }));
  }) as typeof fetch;
  const { mediaDir, handler } = await handlerFixture(fetcher);
  try {
    const publicRequests = [
      new Request(`${BASE}/p/dm9pY2UtbWVtby5tcDM`),
      new Request(`${BASE}/api/page?file=voice-memo.mp3`),
      jsonRequest("/api/generate", { file: "voice-memo.mp3" }),
    ];
    for (const request of publicRequests) {
      assertEquals((await handler(request)).status, 200);
    }
    const uploadForm = new FormData();
    uploadForm.append(
      "media",
      new File(
        [await Deno.readFile("media/voice-memo.mp3")],
        "ordinary-upload.mp3",
        { type: "audio/mpeg" },
      ),
    );
    assertEquals(
      (await handler(
        new Request(`${BASE}/api/upload`, {
          method: "POST",
          body: uploadForm,
        }),
      )).status,
      200,
    );
    assertEquals(fetchCalls, 0);

    const get = await handler(new Request(`${BASE}/api/enrich`));
    assertEquals(get.status, 405);
    assertEquals(get.headers.get("allow"), "POST");
    assertEquals(fetchCalls, 0);

    for (const token of ["wrong", ""]) {
      const response = await handler(
        jsonRequest("/api/enrich", { file: "voice-memo.mp3" }, token),
      );
      assertEquals(response.status, 401);
      const text = await response.text();
      assertEquals(text.includes(OWNER_TOKEN), false);
      assertEquals(text.includes(API_KEY), false);
    }
    assertEquals(fetchCalls, 0);

    const enriched = await handler(
      jsonRequest("/api/enrich", { file: "voice-memo.mp3" }),
    );
    assertEquals(enriched.status, 200);
    assertEquals((await enriched.json()).data.title, "Owner enriched");
    assertEquals(fetchCalls, 1);

    // Enrichment is never inserted into the public deterministic cache.
    const publicPage = await handler(
      new Request(`${BASE}/api/page?file=voice-memo.mp3`),
    );
    assertEquals(
      (await publicPage.json()).title,
      "Voice memo: offline-first ideas",
    );
    assertEquals(fetchCalls, 1);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});

Deno.test("enrichment defaults disabled and bounds requests before fetch", async () => {
  let fetchCalls = 0;
  const fetcher = (() => {
    fetchCalls++;
    return Promise.resolve(geminiResponse({ title: "unexpected" }));
  }) as typeof fetch;
  const mediaDir = await Deno.makeTempDir();
  await Deno.copyFile("media/voice-memo.mp3", `${mediaDir}/voice-memo.mp3`);
  try {
    const disabled = createHandler({ mediaDir });
    assertEquals(
      (await disabled(jsonRequest("/api/enrich", { file: "voice-memo.mp3" })))
        .status,
      404,
    );

    const unavailable = createHandler({
      mediaDir,
      enrichment: { enabled: true, token: OWNER_TOKEN },
    });
    assertEquals(
      (await unavailable(
        jsonRequest("/api/enrich", { file: "voice-memo.mp3" }),
      )).status,
      503,
    );

    const bounded = createHandler({
      mediaDir,
      maxPromptBytes: 4,
      maxEnrichmentRequestBytes: 80,
      enrichment: {
        enabled: true,
        token: OWNER_TOKEN,
        apiKey: API_KEY,
        fetcher,
      },
    });
    const prompt = await bounded(
      jsonRequest("/api/enrich", { file: "voice-memo.mp3", prompt: "12345" }),
    );
    assertEquals(prompt.status, 413);
    assertMatch((await prompt.json()).error, /prompt too large/);

    const request = await bounded(
      jsonRequest("/api/enrich", {
        file: "voice-memo.mp3",
        padding: "x".repeat(200),
      }),
    );
    assertEquals(request.status, 413);
    assertMatch((await request.json()).error, /request too large/);
    assertEquals(fetchCalls, 0);
  } finally {
    await Deno.remove(mediaDir, { recursive: true });
  }
});
