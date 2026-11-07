"use strict";
/* View only. Website interactions go to an ordinary background tab in the same profile. */
(() => {
  const $ = (id) => document.getElementById(id);
  const viewport = $("browser-viewport"),
    screen = $("browser-screen"),
    empty = $("browser-empty");
  const address = $("browse-address"),
    notice = $("browser-alert");
  const send = (payload) => chrome.runtime.sendMessage(payload);
  let viewing = false,
    busy = false,
    refreshing = false,
    timer = null;
  const errorText = (e) => e?.message || String(e);
  function message(text) {
    notice.textContent = text;
  }
  async function frame() {
    if (!viewing || refreshing) return;
    refreshing = true;
    try {
      const r = await send({ type: "VIEW_FRAME" });
      if (!r?.ok) throw new Error(r?.error || "Unable to render webpage.");
      screen.src = r.image;
      screen.hidden = false;
      empty.hidden = true;
      if (r.url) address.value = r.url;
    } catch (e) {
      message(`Loading or capture unavailable: ${errorText(e)}`);
    } finally {
      refreshing = false;
    }
  }
  function startPolling() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void frame();
    }, 1800);
  }
  function stop() {
    viewing = false;
    clearInterval(timer);
    timer = null;
    screen.hidden = true;
    screen.removeAttribute("src");
    empty.hidden = false;
  }
  async function navigate(input) {
    if (busy) return;
    try {
      CopyTypeBrowser.resolveInput(input);
      busy = true;
      message("Opening inside CopyType…");
      const r = await send({ type: "VIEW_OPEN", input });
      if (!r?.ok) throw new Error(r?.error || "Could not open website.");
      viewing = true;
      address.value = r.url;
      message(
        "Click the page to focus a field. Scroll the preview or use the text box below.",
      );
      startPolling();
      setTimeout(() => void frame(), 450);
    } catch (e) {
      message(errorText(e));
    } finally {
      busy = false;
    }
  }
  async function action(payload) {
    if (!viewing) return;
    try {
      const r = await send({ type: "VIEW_ACTION", ...payload });
      if (!r?.ok) throw new Error(r?.error || "Interaction failed.");
      setTimeout(() => void frame(), 200);
    } catch (e) {
      message(errorText(e));
    }
  }
  $("browse-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void navigate(address.value);
  });
  document
    .querySelectorAll("[data-quick]")
    .forEach((b) =>
      b.addEventListener(
        "click",
        () => void navigate(CopyTypeBrowser.SHORTCUTS[b.dataset.quick]),
      ),
    );
  document
    .querySelectorAll("[data-control]")
    .forEach((b) =>
      b.addEventListener(
        "click",
        () => void action({ action: b.dataset.control }),
      ),
    );
  $("view-close").addEventListener("click", async () => {
    try {
      await send({ type: "VIEW_CLOSE" });
      stop();
      address.value = "";
      message("Browser closed. Background tab removed.");
    } catch (e) {
      message(errorText(e));
    }
  });
  screen.addEventListener("click", (e) => {
    const r = screen.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 440,
      y = ((e.clientY - r.top) / r.height) * 720;
    void action({ action: "click", x, y });
    viewport.focus();
  });
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (!viewing) return;
      e.preventDefault();
      void action({
        action: "wheel",
        deltaY: Math.max(-1200, Math.min(1200, e.deltaY)),
      });
    },
    { passive: false },
  );
  viewport.addEventListener("keydown", (e) => {
    if (!viewing) return;
    if (
      [
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.key)
    ) {
      e.preventDefault();
      void action({ action: "key", key: e.key });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void action({ action: "text", text: e.key });
    }
  });
  $("browser-send").addEventListener("click", () => {
    const field = $("browser-text");
    if (field.value) {
      void action({ action: "text", text: field.value });
      field.value = "";
    }
  });
  $("browser-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("browser-send").click();
    }
  });
  $("browser-enter").addEventListener(
    "click",
    () => void action({ action: "key", key: "Enter" }),
  );
  void send({ type: "VIEW_STATUS" }).then((r) => {
    if (r?.open) {
      viewing = true;
      address.value = r.url || "";
      startPolling();
      void frame();
    }
  });
})();
