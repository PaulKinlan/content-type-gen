// Adds a small, isolated control beside the primary media element. It is also
// the status surface for context-menu and toolbar actions.
(() => {
  if (document.getElementById("content-type-gen-root")) return;
  const media = document.querySelector("video,audio");
  const src = media?.currentSrc || media?.src ||
    media?.querySelector("source")?.src;
  if (!media || !src) return;

  const root = document.createElement("div");
  root.id = "content-type-gen-root";
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML =
    `<style>:host{display:block;margin:.75rem 0;font:14px/1.4 system-ui,sans-serif}button{border:0;border-radius:.5rem;background:#1668c7;color:#fff;padding:.6rem .9rem;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #111;outline-offset:2px}p{margin:.4rem 0;color:CanvasText}[data-error="true"]{color:#b42318}</style><button type="button">Generate a page for this media</button><p role="status" aria-live="polite"></p>`;
  const button = shadow.querySelector("button");
  const status = shadow.querySelector("p");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Uploading media and generating its page…";
    const response = await chrome.runtime.sendMessage({
      type: "CONTENT_TYPE_GEN_GENERATE",
      src,
    });
    if (!response?.ok) {
      status.dataset.error = "true";
      status.textContent = response?.error || "Generation failed";
      button.disabled = false;
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "CONTENT_TYPE_GEN_STATUS") return;
    status.dataset.error = String(Boolean(message.isError));
    status.textContent = message.message;
    if (message.isError) button.disabled = false;
  });
  requestAnimationFrame(() => media.insertAdjacentElement("afterend", root));
})();
