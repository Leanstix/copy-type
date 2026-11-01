'use strict';
/* URL resolution is deliberately independent of privileged Chrome APIs. */
const CopyTypeBrowser = (() => {
  const MAX_INPUT = 2048;
  const HOME = 'https://chatgpt.com/';
  const SHORTCUTS = Object.freeze({
    chatgpt: HOME,
    google: 'https://www.google.com/',
    github: 'https://github.com/',
    docs: 'https://developer.mozilla.org/'
  });
  function resolveInput(value) {
    if (typeof value !== 'string') throw new Error('Enter a URL or search query.');
    const input = value.trim();
    if (!input) return null;
    if (input.length > MAX_INPUT) throw new Error('Address or search query is too long.');
    // Never send unsafe or browser-internal URL schemes to a tab.
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
      // localhost:port is a host, rather than a custom URL scheme.
      if (!/^localhost:\d+(?:\/|$)/i.test(input)) throw new Error('Only HTTP and HTTPS addresses are supported.');
    }
    const urlLike = /^https?:\/\//i.test(input) || /^(?:localhost(?::\d+)?|(?:[\w-]+\.)+[a-z]{2,})(?:[:/?#]|$)/i.test(input);
    if (!urlLike) return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
    let parsed;
    try { parsed = new URL(/^https?:\/\//i.test(input) ? input : `${/^localhost(?::\d+)?(?:\/|$)/i.test(input) ? 'http' : 'https'}://${input}`); }
    catch (_) { throw new Error('Invalid URL.'); }
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Unsupported or unsafe address.');
    return parsed.href;
  }
  return Object.freeze({resolveInput, SHORTCUTS, MAX_INPUT});
})();
if (typeof module !== 'undefined') module.exports = CopyTypeBrowser;
