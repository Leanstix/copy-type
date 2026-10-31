/* Page-world editor adapters. Use document-model edits instead of keystrokes, so
 * auto-close, auto-indent and bracket matching cannot modify the entered text.
 * The extension does not need or read external site data. */
(function (root) {
  'use strict';
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  const isCallable = (value) => typeof value === 'function';

  function findAdapter(element) {
    if (!element || !isCallable(element.closest)) return null;
    const aceEl = element.closest('.ace_editor');
    if (aceEl) {
      // Ace stores the existing editor here; do NOT call ace.edit on an unknown
      // element, since that could create a second editor and destroy page state.
      const editor = aceEl.env?.editor;
      const session = editor?.getSession?.();
      const doc = session?.getDocument?.() || session?.doc;
      if (editor && session && doc && isCallable(session.insert) && isCallable(session.replace) && isCallable(doc.positionToIndex)) {
        return {
          kind: 'Ace',
          read: () => editor.getValue(),
          selection: () => {
            const range = editor.getSelectionRange();
            return [doc.positionToIndex(range.start, 0), doc.positionToIndex(range.end, 0)];
          },
          insert: (from, to, text) => {
            const start = doc.indexToPosition(from, 0);
            const end = doc.indexToPosition(to, 0);
            const next = session.replace({start, end}, text);
            const cursor = next && typeof next.row === 'number' ? next : doc.indexToPosition(from + text.length, 0);
            editor.selection.moveCursorToPosition(cursor);
            editor.clearSelection();
          },
          focus: () => editor.focus()
        };
      }
    }
    const cm5 = element.closest('.CodeMirror')?.CodeMirror;
    if (cm5 && isCallable(cm5.replaceRange)) {
      return {
        kind: 'CodeMirror 5',
        read: () => cm5.getValue(),
        selection: () => [cm5.indexFromPos(cm5.getCursor('from')), cm5.indexFromPos(cm5.getCursor('to'))],
        insert: (from, to, text) => {
          cm5.replaceRange(text, cm5.posFromIndex(from), cm5.posFromIndex(to), '+copytype');
          cm5.setCursor(cm5.posFromIndex(from + text.length));
        },
        focus: () => cm5.focus()
      };
    }
    const cm6El = element.closest('.cm-editor');
    // CM6 does not expose a DOM->EditorView API to an extension isolated world.
    // The page-world .cmView connection is implementation-specific; if absent,
    // fall back to the browser's regular text input rather than touching DOM.
    const cm6 = cm6El?.querySelector?.('.cm-content')?.cmView?.view;
    if (cm6 && isCallable(cm6.dispatch) && cm6.state?.doc && cm6.state?.selection) {
      return {
        kind: 'CodeMirror 6',
        read: () => cm6.state.doc.toString(),
        selection: () => [cm6.state.selection.main.from, cm6.state.selection.main.to],
        insert: (from, to, text) => cm6.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length},userEvent:'input.copytype'}),
        focus: () => cm6.focus()
      };
    }
    const monacoEl = element.closest('.monaco-editor');
    const monaco = root.monaco?.editor;
    const editors = isCallable(monaco?.getEditors) ? monaco.getEditors() : [];
    const m = monacoEl && editors.find(e => e.getDomNode?.() === monacoEl);
    const model = m?.getModel?.();
    if (m && model && isCallable(m.executeEdits)) {
      return {
        kind: 'Monaco',
        read: () => model.getValue(),
        selection: () => {
          const s = m.getSelection();
          return [model.getOffsetAt(s.getStartPosition()),model.getOffsetAt(s.getEndPosition())];
        },
        insert: (from,to,text) => {
          const range = {
            startLineNumber:model.getPositionAt(from).lineNumber,
            startColumn:model.getPositionAt(from).column,
            endLineNumber:model.getPositionAt(to).lineNumber,
            endColumn:model.getPositionAt(to).column
          };
          if (!m.executeEdits('copytype', [{range,text,forceMoveMarkers:true}])) throw new Error('Monaco rejected the change');
          m.setPosition(model.getPositionAt(from+text.length));
        },
        focus: () => m.focus()
      };
    }
    return null;
  }

  function makeSession(adapter) {
    const initial = normalize(adapter.read());
    const [from, to] = adapter.selection();
    if (![from,to].every(Number.isSafeInteger) || from < 0 || to < from || to > initial.length) {
      throw new Error('Editor selection is invalid');
    }
    let typed = '';
    return {
      kind: adapter.kind,
      get expected() { return initial.slice(0,from) + typed + initial.slice(to); },
      append(char) {
        if (typeof char !== 'string' || !char.length) throw new Error('Empty input');
        const pos = from + typed.length;
        adapter.insert(pos, pos + (typed.length === 0 ? to-from : 0), char);
        typed += char;
      },
      complete() {
        const expected = initial.slice(0,from) + typed + initial.slice(to);
        let actual = normalize(adapter.read());
        if (actual !== expected) {
          // Reconcile only for a recognized editor with its native data model.
          // This is essential for editor plugins which modify the buffer after edits.
          adapter.insert(0, actual.length, expected);
          actual = normalize(adapter.read());
        }
        if (actual !== expected) throw new Error('Editor contents could not be verified. Check the source before submitting.');
        return {verified: true, characters: Array.from(typed).length};
      }
    };
  }

  const api = {findAdapter, makeSession};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.addEventListener || !root.document) return;
  // Re-injecting a MAIN-world file when arming another task must not stack listeners.
  if (root.__copyTypeBridgeInstalled) return;
  root.__copyTypeBridgeInstalled = true;
  const sessions = new Map();
  root.addEventListener('copytype:request', event => {
    const {id,token,action,char} = event.detail || {};
    if (typeof id !== 'string' || typeof token !== 'string') return;
    const reply = {id,token,ok:true};
    try {
      if (action === 'init') {
        const adapter = findAdapter(event.target);
        if (!adapter) { reply.kind = 'browser-input'; reply.supported = false; }
        else {
          sessions.set(token, makeSession(adapter));
          reply.kind = adapter.kind; reply.supported = true;
        }
      } else if (action === 'append') {
        const session = sessions.get(token);
        if (!session) throw new Error('No matching editor session');
        session.append(char);
      } else if (action === 'complete') {
        const session = sessions.get(token);
        if (!session) throw new Error('No matching editor session');
        Object.assign(reply, session.complete());
        sessions.delete(token);
      } else if (action === 'cancel') {
        sessions.delete(token);
      } else throw new Error('Unsupported editor operation');
    } catch (error) { reply.ok = false; reply.error = error.message || String(error); sessions.delete(token); }
    root.dispatchEvent(new CustomEvent('copytype:response',{detail:reply}));
  });
})(typeof window !== 'undefined' ? window : globalThis);
