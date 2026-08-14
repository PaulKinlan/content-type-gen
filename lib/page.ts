// lib/page.ts — renders a PageData into the bespoke HTML page template. The
// page wraps the media (still playable) with the generated layout: title,
// description, chapter nav (time-coded), transcript panel, and related links.
import { PageData } from "./generate.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
    /"/g,
    "&quot;",
  );

export function renderPage(data: PageData): string {
  const chapters = data.chapters
    .map((c) =>
      `<a class="chapter" href="#t=${c.t}" data-t="${c.t}">${esc(c.label)}</a>`
    )
    .join("");
  const related = data.related
    .map((r) => `<a class="related" href="${esc(r.href)}">${esc(r.label)}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(data.title)}</title>
  <style>
    :root { --bg:#0f1115; --panel:#171a21; --fg:#e8eaf0; --muted:#9aa3b2; --accent:#5ea1ff; }
    * { box-sizing:border-box; }
    body { margin:0; font:16px/1.55 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
    header { padding:1.25rem 1.5rem; border-bottom:1px solid #23272f; }
    header h1 { margin:0 0 .35rem; font-size:1.5rem; }
    header p { margin:0; color:var(--muted); }
    main { display:grid; grid-template-columns: minmax(0,1fr) 320px; gap:1.25rem; padding:1.25rem 1.5rem; }
    @media (max-width:720px){ main{grid-template-columns:1fr;} }
    .media video, .media audio { width:100%; border-radius:10px; background:#000; }
    .media { grid-column:1; }
    .side { grid-column:2; display:flex; flex-direction:column; gap:1.25rem; }
    @media (max-width:720px){ .side{grid-column:1;} }
    .panel { background:var(--panel); border-radius:10px; padding:1rem; }
    .panel h2 { margin:0 0 .75rem; font-size:1rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    .chapter, .related { display:block; color:var(--accent); text-decoration:none; padding:.3rem 0; border-bottom:1px solid #23272f; }
    .chapter:last-child, .related:last-child { border-bottom:0; }
    .transcript { white-space:pre-wrap; font-size:.9rem; color:var(--muted); }
    .badge { display:inline-block; background:#23272f; color:var(--muted); border-radius:999px; padding:.15rem .6rem; font-size:.8rem; }
    .generated { font-size:.8rem; color:var(--muted); margin-top:1rem; }
  </style>
</head>
<body>
  <header>
    <h1>${esc(data.title)}</h1>
    <p>${esc(data.description)}</p>
    <span class="badge">${esc(data.kind)}</span>
  </header>
  <main>
    <section class="media">
      ${
    data.kind === "video"
      ? `<video id="media" controls preload="metadata" src="${
        esc(data.mediaPath)
      }"></video>`
      : `<audio id="media" controls preload="metadata" src="${
        esc(data.mediaPath)
      }"></audio>`
  }
      <p class="generated">Generated ${data.generatedAt} from prompt: “${
    esc(data.sourcePrompt)
  }”</p>
    </section>
    <aside class="side">
      <section class="panel">
        <h2>Chapters</h2>
        ${chapters || '<p class="transcript">No chapters derived.</p>'}
      </section>
      <section class="panel">
        <h2>Related</h2>
        ${related}
      </section>
      <section class="panel">
        <h2>Transcript</h2>
        <div class="transcript">${esc(data.transcript)}</div>
      </section>
    </aside>
  </main>
  <script>
    // Time-coded chapter links: click a #t= link to seek the media.
    document.querySelectorAll('.chapter[data-t]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const m = document.getElementById('media');
        if (!m) return;
        e.preventDefault();
        m.currentTime = Number(a.dataset.t);
        m.play();
      });
    });
    // Deep-link in: ?t= or #t= seeks on load.
    const t = new URLSearchParams(location.search).get('t') || location.hash.match(/t=(\\d+)/)?.[1];
    if (t) { const m = document.getElementById('media'); if (m) m.currentTime = Number(t); }
  </script>
</body>
</html>`;
}
