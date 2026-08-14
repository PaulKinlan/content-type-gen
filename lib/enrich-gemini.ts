// Fixed Gemini enrichment for the explicit owner-only server operation.
// The public generation pipeline never imports credentials or calls a provider.
import {
  type Chapter,
  type PageData,
  type PageEnricher,
  passthroughEnricher,
} from "./generate.ts";
import { type MediaProbe } from "./probe.ts";

const MODEL = "gemini-3.1-flash";
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export const GEMINI_TIMEOUT_MS = 8_000;
export const GEMINI_MAX_RESPONSE_BYTES = 64 * 1024;
export const GEMINI_MAX_OUTPUT_TOKENS = 1_024;
export const MAX_METADATA_BYTES = 8 * 1024;
export const MAX_ENRICHED_TITLE_LENGTH = 160;
export const MAX_ENRICHED_DESCRIPTION_LENGTH = 600;
export const MAX_ENRICHED_CHAPTER_LABEL_LENGTH = 120;
export const MAX_ENRICHED_CHAPTERS = 12;

export interface GeminiEnricherOptions {
  apiKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, maximumBytes));
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, maximumLength);
  return text || null;
}

function parseJSON(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    .trim();
  try {
    const value = JSON.parse(cleaned);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maximumBytes) return null;
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function boundedChapters(value: unknown, probe: MediaProbe): Chapter[] | null {
  if (!Array.isArray(value)) return null;
  const chapters: Chapter[] = [];
  for (const candidate of value.slice(0, MAX_ENRICHED_CHAPTERS)) {
    if (!candidate || typeof candidate !== "object") continue;
    const { t, label } = candidate as Record<string, unknown>;
    const boundedLabel = boundedText(label, MAX_ENRICHED_CHAPTER_LABEL_LENGTH);
    if (
      typeof t !== "number" || !Number.isFinite(t) || t < 0 ||
      (probe.durationSec > 0 && t > probe.durationSec) || !boundedLabel
    ) continue;
    chapters.push({ t, label: boundedLabel });
  }
  return chapters.length ? chapters : null;
}

export function geminiEnricher(options: GeminiEnricherOptions): PageEnricher {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ??
    GEMINI_MAX_RESPONSE_BYTES;

  return async (data: PageData, probe: MediaProbe): Promise<PageData> => {
    if (!options.apiKey) return passthroughEnricher(data, probe);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const metadata = truncateUtf8(
        JSON.stringify({
          filename: probe.path.split(/[\\/]/).pop() ?? "media",
          durationSeconds: Math.round(probe.durationSec * 10) / 10,
          kind: probe.kind,
          codec: probe.codec,
          container: probe.container,
          width: probe.width,
          height: probe.height,
          sourcePrompt: data.sourcePrompt,
        }),
        MAX_METADATA_BYTES,
      );
      const prompt =
        `Generate display metadata for this ${probe.kind} file. Media metadata: ${metadata}. ` +
        `Return strict JSON only with this shape: ` +
        `{"title":"...","description":"one sentence","chapters":[{"t":seconds,"label":"..."}]}. ` +
        `Use no more than ${MAX_ENRICHED_CHAPTERS} chapters. No markdown or commentary.`;
      const response = await fetcher(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return passthroughEnricher(data, probe);
      const responseText = await readBoundedResponse(
        response,
        maxResponseBytes,
      );
      if (responseText == null) return passthroughEnricher(data, probe);
      const responseJSON = parseJSON(responseText);
      const candidateText = responseJSON?.candidates &&
          Array.isArray(responseJSON.candidates)
        ? (responseJSON.candidates[0] as Record<string, unknown> | undefined)
          ?.content
        : undefined;
      const parts = candidateText && typeof candidateText === "object"
        ? (candidateText as Record<string, unknown>).parts
        : undefined;
      const text = Array.isArray(parts) && parts[0] &&
          typeof parts[0] === "object"
        ? (parts[0] as Record<string, unknown>).text
        : undefined;
      if (typeof text !== "string" || text.length > maxResponseBytes) {
        return passthroughEnricher(data, probe);
      }
      const output = parseJSON(text);
      if (!output) return passthroughEnricher(data, probe);
      return {
        ...data,
        title: boundedText(output.title, MAX_ENRICHED_TITLE_LENGTH) ??
          data.title,
        description:
          boundedText(output.description, MAX_ENRICHED_DESCRIPTION_LENGTH) ??
            data.description,
        chapters: boundedChapters(output.chapters, probe) ?? data.chapters,
      };
    } catch {
      return passthroughEnricher(data, probe);
    } finally {
      clearTimeout(timeout);
    }
  };
}
