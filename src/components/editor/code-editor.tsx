import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap, setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll, SearchCursor } from "@codemirror/search";
import { listen } from "@tauri-apps/api/event";
import { getLanguageSupport } from "@/lib/file-type";
import { ghostTheme } from "./codemirror-theme";

interface CodeEditorProps {
  content: string;
  onContentChange: (text: string) => void;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  activeFile: string;
  onEditorReady?: (view: EditorView | null) => void;
}

function countMatches(doc: import("@codemirror/state").Text, term: string): number {
  if (!term) return 0;
  const cursor = new SearchCursor(doc, term, 0, doc.length, (x) => x.toLowerCase());
  let count = 0;
  while (!cursor.next().done) count++;
  return count;
}

function findCurrentIndex(doc: import("@codemirror/state").Text, term: string, pos: number): number {
  if (!term) return 0;
  const cursor = new SearchCursor(doc, term, 0, doc.length, (x) => x.toLowerCase());
  let idx = 0;
  while (!cursor.next().done) {
    if (cursor.value.from >= pos) return idx;
    idx++;
  }
  return 0;
}

export function CodeEditor({
  content,
  onContentChange,
  searchTerm = "",
  replaceTerm = "",
  onSearchResults,
  activeFile,
  onEditorReady,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const matchCountRef = useRef(0);
  const currentIndexRef = useRef(0);

  const flushSave = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    const view = viewRef.current;
    if (view) {
      onContentChangeRef.current(view.state.doc.toString());
    }
  }, []);

  const debouncedSave = useCallback((text: string) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }
    saveTimeout.current = setTimeout(() => {
      onContentChangeRef.current(text);
    }, 1000);
  }, []);

  // Mount CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => { flushSave(); return true; },
    }]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        debouncedSave(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        saveKeymap,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        history(),
        search({ top: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        updateListener,
        ...ghostTheme,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    onEditorReady?.(view);

    getLanguageSupport(activeFile).then((lang) => {
      if (lang && viewRef.current === view) {
        view.dispatch({
          effects: StateEffect.appendConfig.of(lang),
        });
      }
    });

    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
        onContentChangeRef.current(view.state.doc.toString());
      }
      view.destroy();
      viewRef.current = null;
      onEditorReady?.(null);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on window blur
  useEffect(() => {
    const handleBlur = () => flushSave();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [flushSave]);

  // Expose flush function for updater
  useEffect(() => {
    window.__ghostFlushSave = async () => flushSave();
    return () => { delete window.__ghostFlushSave; };
  }, [flushSave]);

  // Listen for flush-saves event
  useEffect(() => {
    let mounted = true;
    const unlisten = listen("flush-saves", () => {
      if (!mounted) return;
      flushSave();
    });
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, [flushSave]);

  // Search integration — recount matches only when searchTerm changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (!searchTerm) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
      matchCountRef.current = 0;
      currentIndexRef.current = 0;
      onSearchResults?.(0, 0);
      return;
    }

    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: searchTerm,
        replace: replaceTerm,
        caseSensitive: false,
      })),
    });

    const count = countMatches(view.state.doc, searchTerm);
    const idx = findCurrentIndex(view.state.doc, searchTerm, view.state.selection.main.from);
    matchCountRef.current = count;
    currentIndexRef.current = idx;
    onSearchResults?.(count, count > 0 ? idx : 0);
  }, [searchTerm, replaceTerm, onSearchResults]);

  // Register window.__ghostSearch — navigation uses cached count
  useEffect(() => {
    window.__ghostSearch = {
      next: () => {
        const view = viewRef.current;
        if (!view) return;
        findNext(view);
        if (matchCountRef.current > 0) {
          currentIndexRef.current = (currentIndexRef.current + 1) % matchCountRef.current;
          onSearchResults?.(matchCountRef.current, currentIndexRef.current);
        }
      },
      previous: () => {
        const view = viewRef.current;
        if (!view) return;
        findPrevious(view);
        if (matchCountRef.current > 0) {
          currentIndexRef.current = (currentIndexRef.current - 1 + matchCountRef.current) % matchCountRef.current;
          onSearchResults?.(matchCountRef.current, currentIndexRef.current);
        }
      },
      replace: () => {
        const view = viewRef.current;
        if (!view) return;
        replaceNext(view);
        matchCountRef.current = countMatches(view.state.doc, searchTerm);
        if (matchCountRef.current > 0) {
          currentIndexRef.current = findCurrentIndex(view.state.doc, searchTerm, view.state.selection.main.from);
          onSearchResults?.(matchCountRef.current, currentIndexRef.current);
        } else {
          onSearchResults?.(0, 0);
        }
      },
      replaceAll: () => {
        const view = viewRef.current;
        if (!view) return;
        replaceAll(view);
        matchCountRef.current = 0;
        currentIndexRef.current = 0;
        onSearchResults?.(0, 0);
      },
    };
    return () => { delete window.__ghostSearch; };
  }, [searchTerm, onSearchResults]);

  return (
    <div
      ref={containerRef}
      className="h-full"
    />
  );
}
