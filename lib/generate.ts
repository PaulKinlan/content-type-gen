// Turns a media probe and prompt into the data used by generated pages.
// The default path is deterministic and offline; callers can provide an enricher
// without coupling the rest of the pipeline to an AI provider.
import { basename, extname } from "std/path/mod.ts";
import { type MediaProbe, probeMedia } from "./probe.ts";
import { pageRouteForFile } from "./route.ts";

export interface Chapter {
  t: number;
  label: string;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface PageData {
  durationSec: number;
  slug: string;
  mediaPath: string;
  kind: "video" | "audio";
  title: string;
  description: string;
  chapters: Chapter[];
  transcript: string;
  transcriptCues: TranscriptCue[];
  related: Array<{ label: string; href: string }>;
  sourcePrompt: string;
  generatedAt: string;
}

export type PageEnricher = (
  data: PageData,
  probe: MediaProbe,
) => PageData | Promise<PageData>;

export const passthroughEnricher: PageEnricher = (data) => data;

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function deriveChapters(
  durationSec: number,
  kind: "audio" | "video",
): Chapter[] {
  if (durationSec <= 0) return [];
  const count = Math.max(2, Math.min(5, Math.ceil(durationSec / 20)));
  const step = durationSec / count;
  return Array.from({ length: count }, (_, index) => {
    const t = Math.round(index * step * 10) / 10;
    return {
      t,
      label: `${kind === "video" ? "Segment" : "Section"} ${index + 1} · ${
        fmtDuration(t)
      }`,
    };
  });
}

function deriveTranscript(
  probe: MediaProbe,
  prompt: string,
  chapters: Chapter[],
): { text: string; cues: TranscriptCue[] } {
  const intro = `${
    probe.kind === "audio" ? "Listen" : "Watch"
  } along with “${prompt}”.`;
  const details = `This ${fmtDuration(probe.durationSec)} ${probe.kind} uses ${
    probe.codec ?? "an unknown codec"
  } in ${probe.container ?? "an unknown container"}.`;
  const lines = [intro, details];
  if (probe.width && probe.height) {
    lines.push(`The picture is ${probe.width} by ${probe.height} pixels.`);
  }

  const cueStarts = chapters.length
    ? chapters.map((chapter) => chapter.t)
    : [0];
  const cueTexts = cueStarts.map((_, index) =>
    index === 0
      ? intro
      : `${chapters[index]?.label ?? `Part ${index + 1}`}: ${prompt}`
  );
  const cues = cueStarts.map((start, index) => ({
    start,
    end: cueStarts[index + 1] ?? Math.max(probe.durationSec, start + 1),
    text: cueTexts[index],
  }));
  return { text: lines.join("\n\n"), cues };
}

export async function generatePage(
  mediaPath: string,
  explicitPrompt?: string,
  enricher: PageEnricher = passthroughEnricher,
): Promise<PageData> {
  const probe = await probeMedia(mediaPath);
  const fileName = basename(mediaPath);
  const slug = pageRouteForFile(fileName);
  const extension = extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const sourcePrompt = probe.metadataPrompt ?? explicitPrompt ??
    `Generate a bespoke page for this ${probe.kind} file “${baseName}” (${
      fmtDuration(probe.durationSec)
    }).`;
  const chapters = deriveChapters(probe.durationSec, probe.kind);
  const transcript = deriveTranscript(probe, sourcePrompt, chapters);

  const data: PageData = {
    durationSec: probe.durationSec,
    slug,
    mediaPath,
    kind: probe.kind,
    title: probe.metadataTitle ??
      `${titleCase(baseName)} · ${titleCase(probe.kind)}`,
    description: `${sourcePrompt} ${
      probe.durationSec > 0 ? `${fmtDuration(probe.durationSec)} of ` : ""
    }${probe.kind} content, presented as a navigable mini-app.`,
    chapters,
    transcript: transcript.text,
    transcriptCues: transcript.cues,
    related: [
      { label: "How it was generated", href: "/#how" },
      { label: "All media", href: "/" },
    ],
    sourcePrompt,
    generatedAt: new Date().toISOString(),
  };

  return await enricher(data, probe);
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(
    /\b\w/g,
    (character) => character.toUpperCase(),
  );
}
