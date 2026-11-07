/* Shared, dependency-free pacing logic; also exported for Node tests. */
(function (root) {
  "use strict";
  const LONG_THRESHOLD = 1800;
  const MAX_HUMAN_RATE = 12; // chars/second; prevents unrealistic five-minute promises
  const SHORT_RATE = 7.5;
  const LONG_TARGET_SECONDS = 300;
  const MAX_CHARS = 100000;

  function countCharacters(text) {
    return Array.from(text.replace(/\r\n?/g, "\n")).length;
  }

  function secondsForCount(count, mode = "natural") {
    if (!Number.isFinite(count) || count < 0)
      throw new RangeError("Invalid character count");
    if (count === 0) return 0;
    // Even exact-entry mode is paced: mode affects input semantics, not speed.
    if (count < LONG_THRESHOLD) return Math.max(1, count / SHORT_RATE);
    return Math.max(LONG_TARGET_SECONDS, count / MAX_HUMAN_RATE);
  }

  function formatSeconds(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const s = Math.ceil(seconds);
    return s >= 60
      ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
      : `${s}s`;
  }

  // Return delays whose sum approximates the desired duration, with small pauses.
  function makeDelays(chars, targetMs, random = Math.random) {
    if (!Array.isArray(chars) || chars.length === 0) return [];
    const weights = chars.map((char) => {
      const variation = 0.75 + random() * 0.5;
      const pause = char === "\n" ? 1.65 : /[;{}]/.test(char) ? 1.2 : 1;
      return variation * pause;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight) => Math.max(5, (targetMs * weight) / sum));
  }

  const api = {
    LONG_THRESHOLD,
    MAX_HUMAN_RATE,
    MAX_CHARS,
    countCharacters,
    secondsForCount,
    formatSeconds,
    makeDelays,
  };
  root.CopyTypeTiming = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
