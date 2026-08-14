// lib/generate.ts — the page-data generator. Turns a media probe (+ optional
// prompt) into a bespoke page: title, description, chapters, transcript, and
// related content. This is the "media is the prompt" seam: today it derives
// from file metadata + an optional prompt string; an LLM can enrich it (see
// the enrich() stub) without changing the rest of the pipeline.
import { type MediaProbe, probeMedia } from "./probe.ts";

export interface PageData {
  durationSec: number;
  slug: string;
  mediaPath: string;
  kind: "video" | "audio";
  title: string;
  description: string;
  /** Time-coded chapters derived from duration (LLM would derive real ones). */
  chapters: Array<{ t: number; label: string }>;
  transcript: string;
  related: Array<{ label: string; href: string }>;
  /** The prompt that drove generation (from metadata or default). */
  sourcePrompt: string;
  generatedAt: string;
}

function slugFor(path: string): string {
  const base = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function deriveChapters(
  durationSec: number,
  kind: string,
): Array<{ t: number; label: string }> {
  if (durationSec <= 0) return [];
  const n = Math.max(2, Math.min(5, Math.floor(durationSec / 20)));
  const step = durationSec / n;
  const chapters: Array<{ t: number; label: string }> = [];
  for (let i = 0; i < n; i++) {
    chapters.push({
      t: Math.round(i * step),
      label: `${kind === "video" ? "Segment" : "Section"} ${i + 1} — ${
        fmtDuration(i * step)
      }`,
    });
  }
  return chapters;
}

function deriveTranscript(probe: MediaProbe): string {
  const kind = probe.kind;
  const lines = [
    `[${kind} transcript — auto-generated placeholder]`,
    `Source: ${probe.path} (${probe.container ?? "unknown"} container, ${
      probe.codec ?? "unknown"
    } codec).`,
    `Duration: ${fmtDuration(probe.durationSec)}.`,
  ];
  if (probe.width) lines.push(`Resolution: ${probe.width}x${probe.height}.`);
  lines.push(
    "",
    "Speech-to-text is a documented extension point: wire a transcription",
    "provider (Whisper, Gemini, OpenAI) into lib/generate.ts enrich() to replace",
    "this placeholder with the real spoken content.",
  );
  return lines.join("\n");
}

/** LLM seam: enrich the derived data with a model. Provider-agnostic; the
 * owner wires their key here. Returns the input unchanged today. */
function enrich(data: PageData, _probe: MediaProbe): PageData {
  // TODO(owner): call an LLM here — e.g. Gemini/OpenAI/Anthropic — to turn the
  // transcript/summary/prompt into a richer title, description, and chapters.
  // Keep this provider-agnostic so the harness has no hard dependency.
  return data;
}

export async function generatePage(
  mediaPath: string,
  explicitPrompt?: string,
): Promise<PageData> {
  const probe = await probeMedia(mediaPath);
  const slug = slugFor(mediaPath);
  const baseName = mediaPath.split("/").pop()!.replace(/\.[^.]+$/, "");

  // The media-as-prompt mechanism: metadata tag wins, then explicit, then default.
  const sourcePrompt = probe.metadataPrompt ?? explicitPrompt ??
    `Generate a bespoke page for this ${probe.kind} file "${baseName}" (${
      fmtDuration(probe.durationSec)
    }).`;

  const data: PageData = {
    durationSec: probe.durationSec,
    slug,
    mediaPath,
    kind: probe.kind,
    title: probe.metadataPrompt
      ? probe.metadataPrompt
      : `${titleCase(baseName)} — a ${probe.kind} presentation`,
    description: `${sourcePrompt} — ${
      probe.durationSec > 0 ? fmtDuration(probe.durationSec) + " of " : ""
    }${probe.kind} content, generated around the file rather than playing it bare.`,
    chapters: deriveChapters(probe.durationSec, probe.kind),
    transcript: deriveTranscript(probe),
    related: [
      { label: "How it was generated", href: "/#how" },
      { label: "All media", href: "/" },
    ],
    sourcePrompt,
    generatedAt: new Date().toISOString(),
  };

  return enrich(data, probe);
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
