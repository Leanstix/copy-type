/* CDP keyboard event descriptors for US-layout printable ASCII and Enter. */
(function (root) {
  'use strict';
  const digitShift = ')!@#$%^&*(';
  const punctuation = {
    ' ': ['Space', 32, false], '-': ['Minus', 189, false], '_': ['Minus', 189, true],
    '=': ['Equal', 187, false], '+': ['Equal', 187, true], '[': ['BracketLeft', 219, false],
    '{': ['BracketLeft', 219, true], ']': ['BracketRight', 221, false], '}': ['BracketRight', 221, true],
    '\\': ['Backslash', 220, false], '|': ['Backslash', 220, true], ';': ['Semicolon', 186, false],
    ':': ['Semicolon', 186, true], "'": ['Quote', 222, false], '"': ['Quote', 222, true],
    ',': ['Comma', 188, false], '<': ['Comma', 188, true], '.': ['Period', 190, false],
    '>': ['Period', 190, true], '/': ['Slash', 191, false], '?': ['Slash', 191, true],
    '`': ['Backquote', 192, false], '~': ['Backquote', 192, true]
  };
  function keyDescriptor(char) {
    if (char === '\n') return { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers: 0 };
    if (/^[a-zA-Z]$/.test(char)) {
      const upper = char.toUpperCase();
      return { key: char, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: char, unmodifiedText: char.toLowerCase(), modifiers: upper === char ? 8 : 0 };
    }
    if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, windowsVirtualKeyCode: char.charCodeAt(0), text: char, unmodifiedText: char, modifiers: 0 };
    const shiftDigit = digitShift.indexOf(char);
    if (shiftDigit !== -1) {
      const digit = String(shiftDigit);
      return { key: char, code: `Digit${digit}`, windowsVirtualKeyCode: digit.charCodeAt(0), text: char, unmodifiedText: digit, modifiers: 8 };
    }
    const mapping = punctuation[char];
    if (mapping) return { key: char, code: mapping[0], windowsVirtualKeyCode: mapping[1], text: char, unmodifiedText: char, modifiers: mapping[2] ? 8 : 0 };
    return null; // e.g. tabs and non-ASCII: Input.insertText preserves these literally
  }
  const api = { keyDescriptor };
  root.CopyTypeKeyboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
