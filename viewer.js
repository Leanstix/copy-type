"use strict";
/* Tab-backed viewer: a real, inactive Chrome tab, rendered locally inside CopyType.
 * It never reads, exports or copies authentication cookies or page source. */
const CopyTypeViewer = (() => {
  function create(api, resolveInput) {
    let session = null;
    let initializing = null;
    const target = () => session && { tabId: session.tabId };
    const send = (method, params = {}) =>
      api.debugger.sendCommand(target(), method, params);
    const getSession = () => session;

    async function dispose(removeTab = false) {
      const old = session;
      session = null;
      if (!old) return;
      if (old.attached) {
        try {
          await api.debugger.detach({ tabId: old.tabId });
        } catch (_) {}
      }
      if (removeTab) {
        try {
          await api.tabs.remove(old.tabId);
        } catch (_) {}
      }
    }
    async function open(input) {
      const url = resolveInput(input);
      if (!url)
        return { ok: false, error: "Enter a web address or search query." };
      if (initializing) await initializing;
      if (session) return navigate(input);
      initializing = (async () => {
        // Chrome cannot run a full browser engine inside a Manifest V3 popup.
        // This is a normal background tab in the current window, NOT a new window.
        const tab = await api.tabs.create({ url, active: false });
        session = { tabId: tab.id, attached: false, url };
        try {
          await api.debugger.attach({ tabId: tab.id }, "1.3");
          session.attached = true;
          await send("Page.enable");
          await send("Emulation.setDeviceMetricsOverride", {
            width: 440,
            height: 720,
            deviceScaleFactor: 1,
            mobile: false,
          });
        } catch (error) {
          await dispose(true);
          throw error;
        }
        return { ok: true, url };
      })();
      try {
        return await initializing;
      } finally {
        initializing = null;
      }
    }
    async function navigate(input) {
      const url = resolveInput(input);
      if (!url) throw new Error("Enter a web address or search query.");
      if (!session) return open(input);
      await send("Page.navigate", { url });
      session.url = url;
      return { ok: true, url };
    }
    async function capture() {
      if (!session) return { ok: false, error: "Choose a destination first." };
      const { data } = await send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 68,
        captureBeyondViewport: false,
        fromSurface: true,
      });
      return {
        ok: true,
        image: `data:image/jpeg;base64,${data}`,
        url: session.url,
      };
    }
    async function interact(message) {
      if (!session) throw new Error("No page is open in CopyType.");
      if (message.action === "click") {
        const x = Number(message.x),
          y = Number(message.y);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > 440 ||
          y < 0 ||
          y > 720
        )
          throw new Error("Invalid click location.");
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      } else if (message.action === "wheel") {
        const deltaY = Number(message.deltaY);
        if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 1500)
          throw new Error("Invalid scroll distance.");
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 210,
          y: 330,
          deltaX: 0,
          deltaY,
        });
      } else if (["back", "forward"].includes(message.action)) {
        const h = await send("Page.getNavigationHistory");
        const at = h.currentIndex + (message.action === "back" ? -1 : 1);
        if (at >= 0 && at < h.entries.length) {
          await send("Page.navigateToHistoryEntry", {
            entryId: h.entries[at].id,
          });
          session.url = h.entries[at].url;
        }
      } else if (message.action === "reload") {
        await send("Page.reload", { ignoreCache: false });
      } else if (message.action === "text") {
        if (
          typeof message.text !== "string" ||
          !message.text ||
          message.text.length > 5000
        )
          throw new Error("Enter 1–5000 characters.");
        await send("Input.insertText", { text: message.text });
      } else if (message.action === "key") {
        const keys = {
          Enter: ["Enter", "Enter", 13, "\r"],
          Backspace: ["Backspace", "Backspace", 8, ""],
          Tab: ["Tab", "Tab", 9, ""],
          Escape: ["Escape", "Escape", 27, ""],
          ArrowUp: ["ArrowUp", "ArrowUp", 38, ""],
          ArrowDown: ["ArrowDown", "ArrowDown", 40, ""],
          ArrowLeft: ["ArrowLeft", "ArrowLeft", 37, ""],
          ArrowRight: ["ArrowRight", "ArrowRight", 39, ""],
          Delete: ["Delete", "Delete", 46, ""],
        };
        const d = keys[message.key];
        if (!d) throw new Error("Unsupported key.");
        const params = {
          key: d[0],
          code: d[1],
          windowsVirtualKeyCode: d[2],
          nativeVirtualKeyCode: d[2],
        };
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          ...params,
          ...(d[3] ? { text: d[3], unmodifiedText: d[3] } : {}),
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
      } else throw new Error("Unknown browser control.");
      return { ok: true };
    }
    function status() {
      return { ok: true, open: !!session, url: session?.url ?? null };
    }
    function onRemoved(tabId) {
      if (session?.tabId === tabId) session = null;
    }
    function onDetach(tabId) {
      if (session?.tabId === tabId) {
        session.attached = false;
        session = null;
      }
    }
    return {
      open,
      navigate,
      capture,
      interact,
      dispose,
      status,
      onRemoved,
      onDetach,
      getSession,
    };
  }
  return { create };
})();
if (typeof module !== "undefined") module.exports = CopyTypeViewer;
