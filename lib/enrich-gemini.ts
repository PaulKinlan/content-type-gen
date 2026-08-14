// Gemini-based page enricher: the media metadata is the prompt; a Gemini text
// model turns it into a real title/description/chapters. Falls back to the
// passthrough (offline) enricher when GEMINI_API_KEY is absent or the call
// fails — never throws for a missing key.
import {
  type PageData,
  type PageEnricher,
  passthroughEnricher,
} from "./generate.ts";
import { type MediaProbe } from "./probe.ts";

const MODEL = "gemini-3.1-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function parseJSON(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function geminiEnricher(): PageEnricher {
  return async (data: PageData, probe: MediaProbe): Promise<PageData> => {
    let key: string | undefined;
    try {
      key = Deno.env.get("GEMINI_API_KEY");
    } catch (error) {
      if (error instanceof Deno.errors.NotCapable) {
        return passthroughEnricher(data, probe);
      }
      throw error;
    }
    if (!key) return passthroughEnricher(data, probe);
    try {
      const prompt =
        `You are generating a bespoke web page for a ${probe.kind} file. Metadata: ` +
        `filename, duration ${
          Math.round(probe.durationSec)
        }s, kind ${probe.kind}. ` +
        `Prompt: "${data.sourcePrompt}". Return strict JSON only: ` +
        `{"title":"...","description":"one sentence","chapters":[{"t":seconds,"label":"..."}]}. ` +
        `No markdown, no commentary.`;
      const res = await fetch(
        `${BASE}/models/${MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }),
        },
      );
      if (!res.ok) return passthroughEnricher(data, probe);
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text as
        | string
        | undefined;
      if (!text) return passthroughEnricher(data, probe);
      const out = parseJSON(text);
      if (!out) return passthroughEnricher(data, probe);
      return {
        ...data,
        title: typeof out.title === "string" && out.title
          ? out.title
          : data.title,
        description: typeof out.description === "string" && out.description
          ? out.description
          : data.description,
        chapters: Array.isArray(out.chapters)
          ? (out.chapters as Array<{ t: number; label: string }>)
            .filter((c) =>
              typeof c.t === "number" && typeof c.label === "string"
            )
            .slice(0, 12)
          : data.chapters,
      };
    } catch {
      return passthroughEnricher(data, probe);
    }
  };
}
