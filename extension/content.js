// Content script (loaded via chrome.scripting in background.js) — currently the
// media detection lives inline in the executeScript func. This file documents
// the detection + a banner that could be injected.
(function () {
  // Detect the primary media element and expose it for the service worker.
  const media = document.querySelector("video, audio");
  if (media && (media.currentSrc || media.src)) {
    window.__contentTypeGenMedia = media.currentSrc || media.src;
  }
})();
