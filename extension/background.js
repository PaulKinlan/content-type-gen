// MV3 service worker: fetch the selected media, upload it to the local
// generator, and open the resulting mini-app. No state is kept in memory.
import { fileNameFor } from "./file-name.js";

const DEFAULT_SERVER = "http://localhost:8080";

function serverForSource(src) {
  const source = new URL(src);
  const loopback = source.hostname === "localhost" ||
    source.hostname === "::1" ||
    source.hostname.startsWith("127.");
  return loopback ? source.origin : DEFAULT_SERVER;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
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
      const media = document.querySelector(
        "video[src],audio[src],video source[src],audio source[src]",
      );
      return media?.currentSrc || media?.src ||
        media?.parentElement?.currentSrc || null;
    },
  });
  return results?.[0]?.result ?? null;
}

async function generateForUrl(src) {
  const sourceResponse = await fetch(src);
  if (!sourceResponse.ok) {
    throw new Error(`Media request failed (${sourceResponse.status})`);
  }
  const type = sourceResponse.headers.get("content-type") ?? "audio/mpeg";
  if (!type.startsWith("audio/") && !type.startsWith("video/")) {
    throw new Error("The selected URL is not audio or video");
  }
  const form = new FormData();
  form.append(
    "media",
    new File([await sourceResponse.blob()], fileNameFor(sourceResponse, src), {
      type,
    }),
  );
  const server = serverForSource(src);
  const capabilityResponse = await fetch(`${server}/api/upload-capability`);
  if (!capabilityResponse.ok) {
    throw new Error("Local upload authorization failed");
  }
  const { capability } = await capabilityResponse.json();
  const generatedResponse = await fetch(`${server}/api/upload`, {
    method: "POST",
    headers: { "x-content-type-gen-capability": capability },
    body: form,
  });
  const generated = await generatedResponse.json();
  if (!generatedResponse.ok) {
    throw new Error(generated.error || "Generation failed");
  }
  return `${server}${generated.pageUrl}`;
}

async function showFeedback(tabId, message, isError = false) {
  if (tabId) {
    await chrome.tabs.sendMessage(tabId, {
      type: "CONTENT_TYPE_GEN_STATUS",
      message,
      isError,
    }).catch(() => {});
  }
  await chrome.action.setBadgeBackgroundColor({
    color: isError ? "#b42318" : "#16784b",
  });
  await chrome.action.setBadgeText({ text: isError ? "!" : "✓" });
}

async function runGeneration(src, tabId) {
  try {
    await showFeedback(tabId, "Uploading media and generating its page…");
    const pageUrl = await generateForUrl(src);
    await showFeedback(tabId, "Generated page opened in a new tab.");
    await chrome.tabs.create({ url: pageUrl });
    return { ok: true, pageUrl };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Generation failed";
    await showFeedback(tabId, message, true);
    return { ok: false, error: message };
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "gen-page-for-media" || !tab?.id) return;
  const src = info.srcUrl || await mediaSrcOnTab(tab.id);
  if (!src) return await showFeedback(tab.id, "No playable media found.", true);
  await runGeneration(src, tab.id);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const src = await mediaSrcOnTab(tab.id);
  if (!src) return await showFeedback(tab.id, "No playable media found.", true);
  await runGeneration(src, tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type !== "CONTENT_TYPE_GEN_GENERATE" ||
    typeof message.src !== "string"
  ) return;
  (async () =>
    sendResponse(await runGeneration(message.src, sender.tab?.id)))();
  return true;
});
