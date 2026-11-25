'use strict';

const CopyTypeEmbedded = (() => {
  function permission(url) {
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Enter the editor origin only, for example https://editor.example.com.');
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Embedded editor origins must use HTTPS, or HTTP on localhost.');
    }
    return {permissions:['webNavigation'], origins:[`${url.protocol}//${url.hostname}/*`]};
  }

  function originOf(url) {
    try { return new URL(url).origin; } catch { return null; }
  }

  function documentsFor(frames, origin) {
    const origins = new Map(frames.map(frame => [frame.frameId, originOf(frame.url)]));
    return frames.filter(frame =>
      frame.frameId > 0 &&
      typeof frame.documentId === 'string' &&
      !frame.errorOccurred &&
      (!frame.documentLifecycle || frame.documentLifecycle === 'active') &&
      origins.get(frame.frameId) === origin &&
      origins.get(frame.parentFrameId) !== origin
    ).map(frame => frame.documentId);
  }

  // These functions run in the selected document's isolated world.
  function hasOrigin(origin) {
    return window.origin === origin && window.origin !== 'null';
  }

  function focusedFrame() {
    let active = document.activeElement;
    while (active) {
      if (active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
        continue;
      }
      if (!active.matches('iframe, frame')) break;
      if (!active.contentDocument) {
        if (active.hasAttribute('sandbox') && !active.sandbox.contains('allow-same-origin')) {
          return {sandboxed:true};
        }
        try {
          const url = new URL(active.src);
          if (['http:', 'https:'].includes(url.protocol)) return {origin:url.origin};
        } catch { /* The frame has no regular web address. */ }
        break;
      }
      active = active.contentDocument.activeElement;
    }
    return {};
  }

  return Object.freeze({permission, documentsFor, hasOrigin, focusedFrame});
})();

if (typeof module !== 'undefined') module.exports = CopyTypeEmbedded;
