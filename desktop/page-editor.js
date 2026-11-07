/* Runs in a website only after the user chooses Select browser editor. */
(() => {
  'use strict';
  if (window.__copyTypeDesktopEditor) return;
  let selected = null, session = null, revision = 0, stopSelection;
  const literalInput = element => {
    if (!element.matches('textarea, input') || element.disabled || element.readOnly) return null;
    if (element.tagName === 'INPUT' && !['text', 'search', 'email', 'url', 'tel'].includes(element.type)) return null;
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    return {
      kind: element.tagName === 'TEXTAREA' ? 'Text area' : 'Text field',
      read: () => element.value,
      selection: () => [element.selectionStart, element.selectionEnd],
      insert: (from, to, text) => {
        setter.call(element, element.value.slice(0, from) + text + element.value.slice(to));
        element.setSelectionRange(from + text.length, from + text.length);
        element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      }
    };
  };
  function choose() {
    stopSelection?.();
    if (session) return Promise.reject(Error('Cancel typing before selecting another editor.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); document.removeEventListener('click', clicked, true); stopSelection = null; };
      const timer = setTimeout(() => { cleanup(); reject(Error('Editor selection timed out.')); }, 60000);
      stopSelection = () => { cleanup(); reject(Error('Editor selection cancelled.')); };
      function clicked(event) {
        const element = event.composedPath().find(node => node instanceof Element && node.closest('textarea,input,.monaco-editor,.ace_editor,.CodeMirror,.cm-editor'));
        if (!element) return;
        const field = element.closest('textarea,input,.monaco-editor,.ace_editor,.CodeMirror,.cm-editor');
        setTimeout(() => {
          try {
            const adapter = window.CopyTypeEditorAdapters.findAdapter(element) || literalInput(field);
            if (!adapter) throw Error('This editor does not expose exact editing. Use its supported editor integration.');
            const selection = adapter.selection();
            if (!selection.every(Number.isSafeInteger)) throw Error('This field does not expose its cursor.');
            selected = {element: field, adapter, selection, initial: adapter.read(), revision: ++revision};
            cleanup(); resolve({revision, kind: adapter.kind, label: `${document.title || 'Website'} · ${adapter.kind}`});
          } catch (error) { cleanup(); reject(error); }
        }, 0);
      }
      document.addEventListener('click', clicked, true);
    });
  }
  async function command(op, args) {
    if (!selected || selected.revision !== args.revision || !selected.element.isConnected) throw Error('Select the browser editor again.');
    const adapter = selected.adapter;
    if (op === 'prepare') {
      if (adapter.read() !== selected.initial) throw Error('Editor changed after selection. Select it again.');
      const [from, to] = selected.selection;
      if (from < 0 || to < from || to > selected.initial.length) throw Error('Invalid editor selection.');
      session = {id: args.session, expected: selected.initial, offset: from, end: to, first: true};
      return true;
    }
    if (!session || session.id !== args.session) throw Error('No matching browser typing task.');
    if (op === 'cancel') {
      if (adapter.read() === session.expected) {
        selected.initial = session.expected;
        if (!session.first) selected.selection = [session.offset, session.offset];
      }
      session = null; return true;
    }
    if (adapter.read() !== session.expected) throw Error('Editor changed outside CopyType. Typing stopped without overwriting those changes.');
    if (op === 'complete') return true;
    if (op !== 'append' || typeof args.char !== 'string' || !args.char.length || args.char.length > 2) throw Error('Invalid editor input.');
    const from = session.offset, to = session.first ? session.end : from;
    const expected = session.expected.slice(0, from) + args.char + session.expected.slice(to);
    adapter.insert(from, to, args.char);
    session.expected = expected; session.offset += args.char.length; session.first = false;
    if (adapter.read() !== expected) throw Error('This editor altered the input. Typing stopped.');
    return true;
  }
  window.__copyTypeDesktopEditor = {choose, command, cancelSelection:()=>stopSelection?.()};
})();
