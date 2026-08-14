import { assertEquals } from "std/assert/mod.ts";
import { fileNameFor } from "../extension/file-name.js";

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

Deno.test("extension preserves an existing media extension", () => {
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/mpeg" } }),
      "https://media.example/recording.ogg",
    ),
    "recording.ogg",
  );
});
