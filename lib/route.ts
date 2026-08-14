// Stable page-route identities derived from the complete stored media filename.
// URL-safe base64 preserves extensions, case, punctuation, and Unicode without
// introducing path separators or filesystem-hostile characters.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function pageRouteForFile(file: string): string {
  const bytes = encoder.encode(file);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function fileForPageRoute(route: string): string | null {
  if (!route || !/^[A-Za-z0-9_-]+$/.test(route)) return null;
  try {
    const base64 = route.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - route.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    const file = decoder.decode(bytes);
    return pageRouteForFile(file) === route ? file : null;
  } catch {
    return null;
  }
}
