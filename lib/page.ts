// Render PageData as a self-contained, progressively enhanced media mini-app.
import { PageData } from "./generate.ts";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function renderPage(data: PageData): string {
  const chapters = data.chapters.map((chapter, index) =>
    `<li><button class="chapter" type="button" data-t="${chapter.t}"${
      index === 0 ? ' aria-current="true"' : ""
    }><span>${esc(chapter.label)}</span></button></li>`
  ).join("");
  const transcript = data.transcriptCues.map((cue, index) =>
    `<li class="transcript-cue" data-start="${cue.start}" data-end="${cue.end}"${
      index === 0 ? ' aria-current="true"' : ""
    }><button type="button" data-t="${cue.start}" aria-label="Seek to ${
      fmtTime(cue.start)
    }"><time>${fmtTime(cue.start)}</time></button><span>${
      esc(cue.text)
    }</span></li>`
  ).join("");
  const related = data.related.map((item) =>
    `<li><a class="related" href="${esc(item.href)}">${
      esc(item.label)
    }</a></li>`
  ).join("");
  const media = data.kind === "video"
    ? `<video id="media" controls preload="metadata" src="${
      esc(data.mediaPath)
    }" aria-details="transcript"></video>`
    : `<audio id="media" controls preload="metadata" src="${
      esc(data.mediaPath)
    }" aria-details="transcript"></audio>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(data.description)}">
  <title>${esc(data.title)} | content-type-gen</title>
  <style>
    :root { color-scheme:dark; --bg:#0f1115; --panel:#171a21; --fg:#f2f4f8; --muted:#b7c0ce; --accent:#78b3ff; --active:#243e63; }
    * { box-sizing:border-box; }
    body { margin:0; font:1rem/1.55 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
    .skip { position:absolute; left:.75rem; top:-4rem; background:var(--fg); color:var(--bg); padding:.5rem; z-index:1; }
    .skip:focus { top:.75rem; }
    header { padding:1.25rem 1.5rem; border-bottom:1px solid #3a404a; }
    h1 { margin:0 0 .35rem; font-size:clamp(1.5rem,4vw,2.25rem); }
    header p { margin:.25rem 0; color:var(--muted); max-width:75ch; }
    main { display:grid; grid-template-columns:minmax(0,1fr) minmax(18rem,24rem); gap:1.25rem; padding:1.25rem 1.5rem; }
    .media video,.media audio { width:100%; border-radius:.625rem; background:#000; }
    .side { display:flex; flex-direction:column; gap:1.25rem; }
    .panel { background:var(--panel); border:1px solid #303640; border-radius:.625rem; padding:1rem; }
    .panel h2 { margin:0 0 .75rem; font-size:1rem; }
    ol,ul { list-style:none; margin:0; padding:0; }
    .chapter,.related { width:100%; display:flex; color:var(--accent); background:transparent; border:0; border-bottom:1px solid #303640; padding:.55rem .25rem; font:inherit; text-align:left; text-decoration:none; cursor:pointer; }
    li:last-child .chapter,li:last-child .related { border-bottom:0; }
    .chapter[aria-current="true"] { background:var(--active); border-inline-start:.25rem solid var(--accent); font-weight:700; padding-inline-start:.5rem; }
    .transcript-cue { display:grid; grid-template-columns:3.25rem 1fr; gap:.5rem; padding:.55rem; border-inline-start:.25rem solid transparent; color:var(--muted); }
    .transcript-cue[aria-current="true"] { background:var(--active); border-inline-start-color:var(--accent); color:var(--fg); font-weight:700; }
    .transcript-cue button { color:var(--accent); background:transparent; border:0; padding:0; font:inherit; text-decoration:underline; cursor:pointer; }
    :where(a,button):focus-visible { outline:.2rem solid #fff; outline-offset:.15rem; }
    .badge { display:inline-block; background:#303640; border-radius:999px; padding:.15rem .6rem; font-size:.8rem; }
    .generated { font-size:.8rem; color:var(--muted); overflow-wrap:anywhere; }
    @media (max-width:48rem) { main { grid-template-columns:1fr; padding-inline:1rem; } }
  </style>
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header>
    <h1>${esc(data.title)}</h1>
    <p>${esc(data.description)}</p>
    <span class="badge">${esc(data.kind)}</span>
  </header>
  <main id="content" tabindex="-1">
    <section class="media" aria-label="Media player">
      ${media}
      <p class="generated">Generated ${esc(data.generatedAt)} from prompt: “${
    esc(data.sourcePrompt)
  }”</p>
    </section>
    <aside class="side" aria-label="Media guide">
      <section class="panel">
        <h2>Chapters</h2>
        ${
    chapters
      ? `<ol id="chapters">${chapters}</ol>`
      : "<p>No chapters derived.</p>"
  }
      </section>
      <section class="panel" id="transcript">
        <h2>Transcript</h2>
        ${
    transcript ? `<ol>${transcript}</ol>` : `<p>${esc(data.transcript)}</p>`
  }
      </section>
      <nav class="panel" aria-label="Related content">
        <h2>Related</h2>
        <ul>${related}</ul>
      </nav>
    </aside>
  </main>
  <script>
    const media = document.getElementById("media");
    const chapterButtons = [...document.querySelectorAll(".chapter[data-t]")];
    const transcriptCues = [...document.querySelectorAll(".transcript-cue[data-start]")];
    const seek = (time) => {
      if (!media) return;
      media.currentTime = Number(time);
      updateActive(Number(time));
      const play = media.play();
      if (play) play.catch(() => {});
    };
    const setCurrent = (items, active) => items.forEach((item) => {
      if (item === active) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
    const updateActive = (time = media?.currentTime ?? 0) => {
      const chapter = chapterButtons.findLast((button) => Number(button.dataset.t) <= time) ?? chapterButtons[0];
      const cue = transcriptCues.find((item) => time >= Number(item.dataset.start) && time < Number(item.dataset.end)) ?? transcriptCues.at(-1);
      setCurrent(chapterButtons, chapter);
      setCurrent(transcriptCues, cue);
    };
    document.querySelectorAll("button[data-t]").forEach((button) => {
      button.addEventListener("click", () => seek(button.dataset.t));
    });
    media?.addEventListener("timeupdate", () => updateActive());
    media?.addEventListener("seeking", () => updateActive());
    const deepLink = new URLSearchParams(location.search).get("t") || location.hash.match(/t=(\\d+(?:\\.\\d+)?)/)?.[1];
    if (deepLink) seek(deepLink);
  </script>
</body>
</html>`;
}
