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

Deno.test("extension normalizes URL extensions against the response MIME", () => {
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "video/ogg" } }),
      "https://media.example/movie.ogg",
    ),
    "movie.ogv",
  );
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/ogg" } }),
      "https://media.example/recording.ogg",
    ),
    "recording.ogg",
  );
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "video/mp4" } }),
      "https://media.example/movie.mp3",
    ),
    "movie.mp4",
  );
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/mp4" } }),
      "https://media.example/recording.mp4",
    ),
    "recording.m4a",
  );
});

Deno.test("extension normalizes disposition extensions against the response MIME", () => {
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: {
          "content-type": "video/ogg",
          "content-disposition": 'attachment; filename="movie.ogg"',
        },
      }),
      "https://media.example/download",
    ),
    "movie.ogv",
  );
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: {
          "content-type": "audio/ogg",
          "content-disposition": 'attachment; filename="recording.ogg"',
        },
      }),
      "https://media.example/download",
    ),
    "recording.ogg",
  );
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: {
          "content-type": "audio/mpeg",
          "content-disposition": 'attachment; filename="recording.mp4"',
        },
      }),
      "https://media.example/download",
    ),
    "recording.mp3",
  );
  assertEquals(
    fileNameFor(
      new Response(null, {
        headers: {
          "content-type": "video/webm",
          "content-disposition": 'attachment; filename="movie.wav"',
        },
      }),
      "https://media.example/download",
    ),
    "movie.webm",
  );
});

Deno.test("extension preserves safe matching filenames", () => {
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "audio/mpeg" } }),
      "https://media.example/Recording.MP3",
    ),
    "Recording.MP3",
  );
  assertEquals(
    fileNameFor(
      new Response(null, { headers: { "content-type": "video/ogg" } }),
      "https://media.example/Movie.ogv",
    ),
    "Movie.ogv",
  );
});
