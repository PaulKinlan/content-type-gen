import { assert, assertEquals } from "std/assert/mod.ts";
import { fileNameFor, MIME_EXTENSIONS } from "../extension/file-name.js";
import { MEDIA_EXTENSIONS } from "../server.ts";

Deno.test("extension derives media extensions for extensionless URLs", () => {
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/mpeg" } }),
      "https://media.example/download/recording",
    ),
    "recording.mp3",
  );
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: { "content-type": "video/webm; codecs=vp9" },
      }),
      "https://media.example/watch/clip",
    ),
    "clip.webm",
  );
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "video/ogg" } }),
      "https://media.example/watch/extensionless-video",
    ),
    "extensionless-video.ogv",
  );
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: {
          "content-type": "audio/mp4",
          "content-disposition": 'attachment; filename="voice-note"',
        },
      }),
      "https://media.example/download",
    ),
    "voice-note.m4a",
  );
});

Deno.test("every MIME-derived extension is accepted by the server", () => {
  for (const extension of new Set(MIME_EXTENSIONS.values())) {
    assert(
      MEDIA_EXTENSIONS.includes(extension),
      `${extension} is derived by the extension but rejected by the server`,
    );
  }
});

Deno.test("extension preserves an existing media extension", () => {
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/mpeg" } }),
      "https://media.example/recording.ogg",
    ),
    "recording.ogg",
  );
});
