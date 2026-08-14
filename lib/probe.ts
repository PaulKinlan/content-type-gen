// lib/probe.ts — media probe. Reads duration/dimensions/codec via ffprobe when
// available; falls back to a metadata-free stub so the harness still works
// without the binary. The probe result is the seed for page generation.
export interface MediaProbe {
  path: string;
  kind: "video" | "audio";
  durationSec: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  container: string | null;
  sizeBytes: number;
  /** A comment/description tag if present in the file metadata (the prompt). */
  metadataPrompt: string | null;
}

export function mediaKind(path: string): "video" | "audio" | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg", "opus", "aac"].includes(ext)) return "audio";
  return null;
}

async function ffprobe(path: string): Promise<{
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: Array<Record<string, unknown>>;
} | null> {
  try {
    const proc = new Deno.Command("/usr/bin/ffprobe", {
      args: [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const out = await proc.output();
    if (!out.success) return null;
    return JSON.parse(new TextDecoder().decode(out.stdout));
  } catch {
    return null;
  }
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const kind = mediaKind(path) ?? "video";
  const sizeBytes = (await Deno.stat(path)).size;
  const info = await ffprobe(path);

  let durationSec = 0;
  let width: number | null = null;
  let height: number | null = null;
  let codec: string | null = null;
  let container: string | null = null;
  let metadataPrompt: string | null = null;

  if (info) {
    container = (info.format?.format_name as string) ?? null;
    durationSec = Number(info.format?.duration ?? 0);
    const streams = (info.streams as Array<Record<string, unknown>>) ?? [];
    for (const s of streams) {
      if (s.codec_type === "video" && width == null) {
        width = Number(s.width ?? 0) || null;
        height = Number(s.height ?? 0) || null;
        codec = (s.codec_name as string) ?? null;
      } else if (s.codec_type === "audio" && codec == null) {
        codec = (s.codec_name as string) ?? null;
      }
    }
    const tags = (info.format?.tags as Record<string, string>) ?? {};
    // The media-as-prompt mechanism: a comment/description tag on the file.
    metadataPrompt = tags.comment ?? tags.description ?? tags.title ?? null;
  }

  return {
    path,
    kind,
    durationSec,
    width,
    height,
    codec,
    container,
    sizeBytes,
    metadataPrompt,
  };
}
