// MV3 service worker: a context menu + toolbar action that finds media on the
// active tab and sends it to the content-type-gen server (or reports it).
const SERVER = "http://localhost:8080";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "gen-page-for-media",
    title: "Generate a page for this media",
    contexts: ["video", "audio"],
  });
});

async function mediaSrcOnTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const pick = (sel) => {
        for (const el of document.querySelectorAll(sel)) {
          const src = el.currentSrc || el.src;
          if (src) return src;
        }
        return null;
      };
      return pick("video") || pick("audio");
    },
  });
  return results?.[0]?.result ?? null;
}

function generateForUrl(src) {
  // Point the user at the server's generate endpoint for this media URL.
  // (Full server-side download/upload is a documented extension point.)
  const u = new URL(src);
  return `${SERVER}/api/generate?media=${encodeURIComponent(u.href)}`;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "gen-page-for-media" || !tab?.id) return;
  const src = info.srcUrl || (await mediaSrcOnTab(tab.id));
  if (!src) return;
  await chrome.tabs.create({ url: generateForUrl(src) });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const src = await mediaSrcOnTab(tab.id);
  if (!src) return;
  await chrome.tabs.create({ url: generateForUrl(src) });
});
