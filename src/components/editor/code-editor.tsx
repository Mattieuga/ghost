import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState, StateEffect, type Text } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap, setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll, SearchCursor } from "@codemirror/search";
import { getLanguageSupport } from "@/lib/file-type";
import { ghostTheme } from "./codemirror-theme";
import { detectLineSeparator, type SourceDocumentSnapshot } from "@/lib/source-document";
import type { SourceProfile } from "@/lib/resource-policy";
import { performanceNow, type FileOpenPerformanceTrace } from "@/lib/open-performance";
import { installPointerFocusScrollGuard } from "@/lib/codemirror-scroll";

interface CodeEditorProps {
  content: string | Text;
  onContentChange: (snapshot: SourceDocumentSnapshot) => Promise<void>;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  activeFile: string;
  onEditorReady?: (view: EditorView | null) => void;
  sourceProfile?: SourceProfile;
  lineSeparator?: string;
  onDirtyChange?: (dirty: boolean) => void;
  openPerformance?: FileOpenPerformanceTrace | null;
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
  sourceProfile = "normal",
  lineSeparator,
  onDirtyChange,
  openPerformance,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const lastSubmittedRef = useRef<Text | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const matchCountRef = useRef(0);
  const currentIndexRef = useRef(0);

  const flushSave = useCallback(async () => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    const view = viewRef.current;
    if (view && (dirtyRef.current || lastSubmittedRef.current !== view.state.doc)) {
      const document = view.state.doc;
      lastSubmittedRef.current = document;
      await onContentChangeRef.current({ document, lineSeparator: view.state.lineBreak });
      if (viewRef.current?.state.doc === document) {
        dirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      }
    }
  }, []);

  const debouncedSave = useCallback((document: Text) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null;
      lastSubmittedRef.current = document;
      const view = viewRef.current;
      const lineSeparator = view?.state.lineBreak ?? "\n";
      void Promise.resolve(onContentChangeRef.current({ document, lineSeparator }))
        .then(() => {
          if (viewRef.current?.state.doc === document) {
            dirtyRef.current = false;
            onDirtyChangeRef.current?.(false);
          }
        })
        .catch(() => {});
    }, sourceProfile === "large" ? 2500 : 1000);
  }, [sourceProfile]);

  // Mount CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;
    openPerformance?.markViewerStarted();

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => { flushSave(); return true; },
    }]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        if (!dirtyRef.current) {
          dirtyRef.current = true;
          onDirtyChangeRef.current?.(true);
        }
        debouncedSave(update.state.doc);
      }
    });

    const sharedExtensions = [
        EditorState.lineSeparator.of(
          lineSeparator ?? (typeof content === "string" ? detectLineSeparator(content) : "\n"),
        ),
        saveKeymap,
        lineNumbers(),
        drawSelection(),
        history(),
        search({ top: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        updateListener,
        ...ghostTheme,
    ];
    const normalExtensions = sourceProfile === "normal" ? [
      highlightActiveLineGutter(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      keymap.of([...closeBracketsKeymap, ...foldKeymap]),
      EditorView.lineWrapping,
    ] : [];

    let stageStarted = performanceNow();
    const state = EditorState.create({
      doc: content,
      extensions: [...sharedExtensions, ...normalExtensions],
    });
    openPerformance?.recordViewer(
      "Create CodeMirror editor state",
      performanceNow() - stageStarted,
      `${state.doc.lines.toLocaleString()} lines`,
    );

    stageStarted = performanceNow();
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    const removePointerFocusScrollGuard = installPointerFocusScrollGuard(view);
    openPerformance?.recordViewer("Create CodeMirror view", performanceNow() - stageStarted);
    openPerformance?.markViewCreated();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => openPerformance?.finishAfterFirstPaint());
    });

    viewRef.current = view;
    lastSubmittedRef.current = view.state.doc;
    dirtyRef.current = false;
    onDirtyChangeRef.current?.(false);
    onEditorReady?.(view);

    if (sourceProfile === "normal") getLanguageSupport(activeFile).then((lang) => {
      if (lang && viewRef.current === view) {
        view.dispatch({
          effects: StateEffect.appendConfig.of(lang),
        });
      }
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
        const document = view.state.doc;
        lastSubmittedRef.current = document;
        void Promise.resolve(onContentChangeRef.current({
          document,
          lineSeparator: view.state.lineBreak,
        })).catch(() => {});
      }
      removePointerFocusScrollGuard();
      view.destroy();
      viewRef.current = null;
      onEditorReady?.(null);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on window blur
  useEffect(() => {
    const handleBlur = () => { void flushSave().catch(() => {}); };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [flushSave]);

  // Expose flush function for updater
  useEffect(() => {
    window.__ghostFlushEditorSave = flushSave;
    // Keep the editor useful in isolation (including component tests), while
    // the window-level coordinator replaces this with editor + native queue.
    if (!window.__ghostFlushSave) window.__ghostFlushSave = flushSave;
    return () => {
      if (window.__ghostFlushEditorSave === flushSave) delete window.__ghostFlushEditorSave;
      if (window.__ghostFlushSave === flushSave) delete window.__ghostFlushSave;
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

    if (sourceProfile === "large") {
      matchCountRef.current = -1;
      currentIndexRef.current = 0;
      onSearchResults?.(-1, 0);
      return;
    }

    const count = countMatches(view.state.doc, searchTerm);
    const idx = findCurrentIndex(view.state.doc, searchTerm, view.state.selection.main.from);
    matchCountRef.current = count;
    currentIndexRef.current = idx;
    onSearchResults?.(count, count > 0 ? idx : 0);
  }, [searchTerm, replaceTerm, onSearchResults, sourceProfile]);

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
