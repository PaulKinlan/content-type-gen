// lib/probe.ts — media probe. Reads duration/dimensions/codec via ffprobe when
// available; falls back to a metadata-free stub for page generation. Upload
// validation uses the strict probe path so unverified bytes are never hosted.
export interface MediaProbe {
  path: string;
  kind: "video" | "audio";
  durationSec: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  container: string | null;
  sizeBytes: number;
  /** A title tag suitable for the generated page heading. */
  metadataTitle: string | null;
  /** A comment/description/title tag if present in the file metadata. */
  metadataPrompt: string | null;
}

interface FfprobeInfo {
  format?: {
    format_name?: string;
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<Record<string, unknown>>;
}

type FfprobeResult =
  | { state: "ok"; info: FfprobeInfo }
  | { state: "invalid" }
  | { state: "unavailable" };

export class FfprobeUnavailableError extends Error {
  constructor() {
    super("ffprobe is required to validate uploads");
    this.name = "FfprobeUnavailableError";
  }
}

export function mediaKind(path: string): "video" | "audio" | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg", "opus", "aac"].includes(ext)) {
    return "audio";
  }
  return null;
}

/**
 * An explicit executable can be supplied without invoking a shell. Otherwise
 * Deno.Command resolves `ffprobe` through the process PATH.
 */
export function ffprobeExecutable(
  configured = Deno.env.get("FFPROBE_PATH"),
): string {
  return configured?.trim() || "ffprobe";
}

async function runFfprobe(path: string): Promise<FfprobeResult> {
  try {
    const proc = new Deno.Command(ffprobeExecutable(), {
      args: [
        "-v",
        "error",
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
    if (!out.success) return { state: "invalid" };
    try {
      return {
        state: "ok",
        info: JSON.parse(new TextDecoder().decode(out.stdout)),
      };
    } catch {
      return { state: "invalid" };
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { state: "unavailable" };
    throw error;
  }
}

/** Strictly verifies that ffprobe found a stream matching the file extension. */
export async function validateMediaFile(
  path: string,
  expectedKind: "video" | "audio",
): Promise<boolean> {
  const result = await runFfprobe(path);
  if (result.state === "unavailable") throw new FfprobeUnavailableError();
  if (result.state !== "ok") return false;
  return (result.info.streams ?? []).some((stream) =>
    stream.codec_type === expectedKind && typeof stream.codec_name === "string"
  );
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const kind = mediaKind(path) ?? "video";
  const sizeBytes = (await Deno.stat(path)).size;
  const result = await runFfprobe(path);
  const info = result.state === "ok" ? result.info : null;

  let durationSec = 0;
  let width: number | null = null;
  let height: number | null = null;
  let codec: string | null = null;
  let container: string | null = null;
  let metadataTitle: string | null = null;
  let metadataPrompt: string | null = null;

  if (info) {
    container = info.format?.format_name ?? null;
    durationSec = Number(info.format?.duration ?? 0);
    const streams = info.streams ?? [];
    for (const stream of streams) {
      if (stream.codec_type === "video" && width == null) {
        width = Number(stream.width ?? 0) || null;
        height = Number(stream.height ?? 0) || null;
        codec = (stream.codec_name as string) ?? null;
      } else if (stream.codec_type === "audio" && codec == null) {
        codec = (stream.codec_name as string) ?? null;
      }
    }
    const tags = info.format?.tags ?? {};
    metadataTitle = tags.title ?? null;
    // The media-as-prompt mechanism: descriptive tags carried by the file.
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
    metadataTitle,
    metadataPrompt,
  };
}
