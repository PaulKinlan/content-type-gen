const MIME_EXTENSIONS = new Map([
  ["audio/aac", ".aac"],
  ["audio/mp4", ".m4a"],
  ["audio/mpeg", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/opus", ".opus"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["video/mp4", ".mp4"],
  ["video/ogg", ".ogv"],
  ["video/quicktime", ".mov"],
  ["video/webm", ".webm"],
]);

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function fileNameFor(response, src) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const fromHeader = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const fromUrl = new URL(src).pathname.split("/").pop();
  const type = (response.headers.get("content-type") ?? "audio/mpeg")
    .split(";", 1)[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS.get(type) ??
    (type.startsWith("video/") ? ".mp4" : ".mp3");
  const candidate = decoded(fromHeader || fromUrl || "extension-media")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/[. -]+$/g, "") || "extension-media";
  return /\.[a-zA-Z0-9]+$/.test(candidate)
    ? candidate
    : `${candidate}${extension}`;
}
