// scripts/generate.ts — pregeneration build step. Generates the bespoke pages
// for every media file in ./media and writes the HTML into ./dist so the
// result can be served statically (no runtime generation needed).
//
//   deno run --allow-read --allow-write scripts/generate.ts
import { generatePage } from "../lib/generate.ts";
import { renderPage } from "../lib/page.ts";
import { extname } from "std/path/mod.ts";

const MEDIA_DIR = "./media";
const DIST = "./dist";
await Deno.mkdir(DIST, { recursive: true });

const exts = [
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".opus",
  ".aac",
];
const files: string[] = [];
for await (const e of Deno.readDir(MEDIA_DIR)) {
  if (e.isFile && exts.includes(extname(e.name).toLowerCase())) {
    files.push(e.name);
  }
}

let count = 0;
for (const f of files.sort()) {
  const data = await generatePage(`${MEDIA_DIR}/${f}`);
  data.mediaPath = `/media/${f}`;
  const html = renderPage(data);
  await Deno.writeTextFile(`${DIST}/${data.slug}.html`, html);
  console.log(
    `generated ${data.slug}.html from ${f} (${data.kind}, ${
      data.durationSec.toFixed(1)
    }s)`,
  );
  count++;
}
console.log(`pregenerated ${count} pages into ${DIST}/`);
