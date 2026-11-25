/* Page-world editor adapters. Use document-model edits instead of keystrokes, so
 * auto-close, auto-indent and bracket matching cannot modify the entered text.
 * The extension does not need or read external site data. */
(function (root) {
  "use strict";
  const normalize = (text) => text.replace(/\r\n?/g, "\n");
  const isCallable = (value) => typeof value === "function";

  function focusedElement() {
    let element = root.document.activeElement;
    while (element) {
      const inner = element.shadowRoot?.activeElement ?? element.contentDocument?.activeElement;
      if (!inner) break;
      element = inner;
    }
    return element;
  }

  function findAdapter(element) {
    if (!element || !isCallable(element.closest)) return null;
    const aceEl = element.closest(".ace_editor");
    if (aceEl) {
      // Ace stores the existing editor here; do NOT call ace.edit on an unknown
      // element, since that could create a second editor and destroy page state.
      const editor = aceEl.env?.editor;
      const session = editor?.getSession?.();
      const doc = session?.getDocument?.() || session?.doc;
      if (
        editor &&
        session &&
        doc &&
        isCallable(session.replace) &&
        isCallable(doc.indexToPosition) &&
        isCallable(doc.positionToIndex)
      ) {
        return {
          kind: "Ace",
          readOnly: () => editor.getReadOnly?.(),
          lineBreak: () => doc.getNewLineCharacter?.(),
          read: () => editor.getValue(),
          selection: () => {
            const range = editor.getSelectionRange();
            return [
              doc.positionToIndex(range.start, 0),
              doc.positionToIndex(range.end, 0),
            ];
          },
          insert: (from, to, text) => {
            const start = doc.indexToPosition(from, 0);
            const end = doc.indexToPosition(to, 0);
            const next = session.replace({ start, end }, text);
            const cursor =
              next && typeof next.row === "number"
                ? next
                : doc.indexToPosition(from + text.length, 0);
            editor.selection.moveCursorToPosition(cursor);
            editor.clearSelection();
          },
        };
      }
    }
    const cm5 = element.closest(".CodeMirror")?.CodeMirror;
    if (cm5 && isCallable(cm5.replaceRange)) {
      return {
        kind: "CodeMirror 5",
        readOnly: () => cm5.getOption?.("readOnly"),
        lineBreak: () => cm5.getDoc?.().lineSeparator?.(),
        read: () => cm5.getValue(),
        selection: () => [
          cm5.indexFromPos(cm5.getCursor("from")),
          cm5.indexFromPos(cm5.getCursor("to")),
        ],
        insert: (from, to, text) => {
          cm5.replaceRange(
            text,
            cm5.posFromIndex(from),
            cm5.posFromIndex(to),
            "+copytype",
          );
          cm5.setCursor(cm5.posFromIndex(from + text.length));
        },
      };
    }
    const cm6El = element.closest(".cm-editor");
    // Bundled sites may not expose EditorView. Use the links on the content
    // element that its findFromDOM method uses in current and older releases.
    const content = cm6El?.querySelector(".cm-content");
    const cm6 = content?.cmTile?.root?.view ?? content?.cmView?.view;
    if (
      cm6 &&
      isCallable(cm6.dispatch) &&
      cm6.state?.doc &&
      cm6.state?.selection
    ) {
      return {
        kind: "CodeMirror 6",
        readOnly: () => cm6.state.readOnly || content.contentEditable === "false",
        read: () => cm6.state.doc.toString(),
        selection: () => [
          cm6.state.selection.main.from,
          cm6.state.selection.main.to,
        ],
        insert: (from, to, text) =>
          cm6.dispatch({
            changes: {
              from, to,
              insert: cm6.state.toText
                ? cm6.state.toText(text.replace(/\n/g, () => cm6.state.lineBreak))
                : text,
            },
            selection: { anchor: from + text.length },
            userEvent: "input.copytype",
          }),
      };
    }
    const monacoEl = element.closest(".monaco-editor");
    const monaco = (element.ownerDocument?.defaultView ?? root).monaco?.editor;
    const m = monacoEl && monaco?.getEditors?.().find((editor) => {
      const node = editor.getDomNode();
      return node === monacoEl || node?.contains(element);
    });
    const model = m?.getModel?.();
    if (m && model && isCallable(m.executeEdits)) {
      return {
        kind: "Monaco",
        readOnly: () => m.getRawOptions?.().readOnly,
        lineBreak: () => model.getEOL?.(),
        read: () => model.getValue(),
        selection: () => {
          const s = m.getSelection();
          return [
            model.getOffsetAt(s.getStartPosition()),
            model.getOffsetAt(s.getEndPosition()),
          ];
        },
        insert: (from, to, text) => {
          const start = model.getPositionAt(from);
          const end = model.getPositionAt(to);
          const range = {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
          if (
            !m.executeEdits("copytype", [
              { range, text, forceMoveMarkers: true },
            ])
          )
            throw new Error("Monaco rejected the change");
          m.setPosition(model.getPositionAt(from + text.length));
        },
      };
    }
    return null;
  }

  function makeSession(adapter) {
    const requireWritable = () => {
      if (adapter.readOnly?.()) throw new Error("The editor is read-only.");
    };
    requireWritable();
    const initial = adapter.read();
    const lineBreak = adapter.lineBreak?.() ?? "\n";
    const [from, to] = adapter.selection();
    if (
      ![from, to].every(Number.isSafeInteger) ||
      from < 0 ||
      to < from ||
      to > initial.length
    ) {
      throw new Error("Editor selection is invalid");
    }
    let typed = "";
    let characters = 0;
    return {
      kind: adapter.kind,
      get expected() {
        return initial.slice(0, from) + typed + initial.slice(to);
      },
      append(char) {
        if (typeof char !== "string" || !char.length)
          throw new Error("Empty input");
        requireWritable();
        const text = normalize(char).replace(/\n/g, () => lineBreak);
        const pos = from + typed.length;
        adapter.insert(pos, pos + (characters === 0 ? to - from : 0), text);
        typed += text;
        characters += Array.from(char).length;
      },
      complete() {
        requireWritable();
        const expected = initial.slice(0, from) + typed + initial.slice(to);
        let actual = adapter.read();
        if (actual !== expected) {
          // Reconcile only for a recognized editor with its native data model.
          // This is essential for editor plugins which modify the buffer after edits.
          adapter.insert(0, actual.length, expected);
          actual = adapter.read();
        }
        if (actual !== expected)
          throw new Error(
            "Editor contents could not be verified. Check the source before submitting.",
          );
        return { verified: true, characters };
      },
    };
  }

  const api = { findAdapter, makeSession };
  root.CopyTypeEditorAdapters = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.addEventListener || !root.document) return;
  // Re-injecting a MAIN-world file when arming another task must not stack listeners.
  if (root.__copyTypeBridgeInstalled) return;
  root.__copyTypeBridgeInstalled = true;
  const sessions = new Map();
  root.addEventListener("copytype:request", (event) => {
    const { id, token, action, char } = event.detail || {};
    if (typeof id !== "string" || typeof token !== "string") return;
    const reply = { id, token, ok: true };
    try {
      if (action === "init") {
        // DOM elements cannot be serialized across the extension and page worlds.
        const target = event.target === root ? focusedElement() : event.target;
        const adapter = findAdapter(target);
        if (!adapter) {
          reply.kind = "browser-input";
          reply.supported = false;
        } else {
          sessions.set(token, makeSession(adapter));
          reply.kind = adapter.kind;
          reply.supported = true;
        }
      } else if (action === "append") {
        const session = sessions.get(token);
        if (!session) throw new Error("No matching editor session");
        session.append(char);
      } else if (action === "complete") {
        const session = sessions.get(token);
        if (!session) throw new Error("No matching editor session");
        Object.assign(reply, session.complete());
        sessions.delete(token);
      } else if (action === "cancel") {
        sessions.delete(token);
      } else throw new Error("Unsupported editor operation");
    } catch (error) {
      reply.ok = false;
      reply.error = error.message || String(error);
      sessions.delete(token);
    }
    root.dispatchEvent(new CustomEvent("copytype:response", { detail: reply }));
  });
})(typeof window !== "undefined" ? window : globalThis);
