// Vendored from @sereneinserenade/tiptap-search-and-replace (MIT License)
// Enhanced with scroll-into-view on result navigation

import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm: (searchTerm: string) => ReturnType;
      setReplaceTerm: (replaceTerm: string) => ReturnType;
      resetIndex: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
    };
  }
}

interface SearchAndReplaceStorage {
  searchTerm: string;
  replaceTerm: string;
  results: { from: number; to: number }[];
  resultIndex: number;
  lastSearchTerm: string;
}

interface SearchAndReplaceOptions {
  searchResultClass: string;
  searchResultCurrentClass: string;
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

function getRegex(s: string): RegExp {
  return RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

function processSearches(
  doc: PMNode,
  searchTerm: string
): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = [];

  if (!searchTerm) return results;

  const mergedTextNodes: TextNodesWithPosition[] = [];
  let index = 0;

  doc.descendants((node, pos) => {
    if (node.isText) {
      if (mergedTextNodes[index]) {
        mergedTextNodes[index] = {
          text: mergedTextNodes[index].text + node.text,
          pos: mergedTextNodes[index].pos,
        };
      } else {
        mergedTextNodes[index] = {
          text: node.text ?? "",
          pos,
        };
      }
    } else {
      index += 1;
    }
  });

  const regex = getRegex(searchTerm);

  for (const entry of mergedTextNodes) {
    if (!entry) continue;
    const { text, pos } = entry;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      if (m[0] === "") break;
      results.push({
        from: pos + m.index,
        to: pos + m.index + m[0].length,
      });
    }
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function replace(replaceTerm: string, results: { from: number; to: number }[], { state, dispatch }: any) {
  const firstResult = results[0];
  if (!firstResult) return;

  const { from, to } = firstResult;
  if (dispatch) dispatch(state.tr.insertText(replaceTerm, from, to));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rebaseNextResult(replaceTerm: string, index: number, lastOffset: number, results: { from: number; to: number }[]): [number, { from: number; to: number }[] | null] {
  const nextIndex = index + 1;
  if (!results[nextIndex]) return [lastOffset, null];

  const { from: currentFrom, to: currentTo } = results[index];
  const offset = currentFrom - currentTo + replaceTerm.length;
  const { from, to } = results[nextIndex];

  results[nextIndex] = {
    from: from + offset + lastOffset,
    to: to + offset + lastOffset,
  };

  return [offset + lastOffset, results];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function replaceAll(replaceTerm: string, results: { from: number; to: number }[], { tr, dispatch }: any) {
  if (!results.length) return;

  let offset = 0;

  for (let i = 0; i < results.length; i += 1) {
    const { from, to } = results[i];
    tr.insertText(replaceTerm, from, to);
    const [newOffset, newResults] = rebaseNextResult(replaceTerm, i, offset, results);
    offset = newOffset;
    if (newResults) results = newResults;
  }

  if (dispatch) dispatch(tr);
}

const searchAndReplacePluginKey = new PluginKey("searchAndReplace");

function scrollToResult(view: EditorView, result: { from: number; to: number }) {
  const { node } = view.domAtPos(result.from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (element) {
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export const SearchAndReplace = Extension.create<SearchAndReplaceOptions, SearchAndReplaceStorage>({
  name: "searchAndReplace",

  addOptions() {
    return {
      searchResultClass: "search-result",
      searchResultCurrentClass: "search-result-current",
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      results: [],
      resultIndex: 0,
      lastSearchTerm: "",
    };
  },

  addCommands() {
    return {
      setSearchTerm:
        (searchTerm: string) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.searchTerm = searchTerm;
          return false;
        },
      setReplaceTerm:
        (replaceTerm: string) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.replaceTerm = replaceTerm;
          return false;
        },
      resetIndex:
        () =>
        ({ editor }) => {
          editor.storage.searchAndReplace.resultIndex = 0;
          return false;
        },
      nextSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          if (results.length === 0) return false;
          const nextIndex = (resultIndex + 1) % results.length;
          editor.storage.searchAndReplace.resultIndex = nextIndex;
          scrollToResult(editor.view, results[nextIndex]);
          return false;
        },
      previousSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          if (results.length === 0) return false;
          const prevIndex = (resultIndex - 1 + results.length) % results.length;
          editor.storage.searchAndReplace.resultIndex = prevIndex;
          scrollToResult(editor.view, results[prevIndex]);
          return false;
        },
      replace:
        () =>
        ({ editor, state, dispatch }) => {
          const { replaceTerm, results } = editor.storage.searchAndReplace;
          replace(replaceTerm, results, { state, dispatch });
          return false;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const { replaceTerm, results } = editor.storage.searchAndReplace;
          replaceAll(replaceTerm, results, { tr, dispatch });
          return false;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { searchResultClass, searchResultCurrentClass } = this.options;

    return [
      new Plugin({
        key: searchAndReplacePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: ({ docChanged }, oldState) => {
            const { searchTerm, lastSearchTerm, resultIndex } = editor.storage.searchAndReplace;

            if (!docChanged && lastSearchTerm === searchTerm && oldState !== DecorationSet.empty) {
              // Only result index changed — rebuild decorations with new current
              if (searchTerm) {
                const { results } = editor.storage.searchAndReplace;
                return DecorationSet.create(
                  editor.state.doc,
                  results.map((r: { from: number; to: number }, i: number) =>
                    Decoration.inline(r.from, r.to, {
                      class: i === resultIndex
                        ? `${searchResultClass} ${searchResultCurrentClass}`
                        : searchResultClass,
                    })
                  )
                );
              }
              return oldState;
            }

            editor.storage.searchAndReplace.lastSearchTerm = searchTerm;

            if (!searchTerm) {
              editor.storage.searchAndReplace.results = [];
              editor.storage.searchAndReplace.resultIndex = 0;
              return DecorationSet.empty;
            }

            const results = processSearches(editor.state.doc, searchTerm);
            editor.storage.searchAndReplace.results = results;

            // Clamp resultIndex
            if (editor.storage.searchAndReplace.resultIndex >= results.length) {
              editor.storage.searchAndReplace.resultIndex = 0;
            }

            return DecorationSet.create(
              editor.state.doc,
              results.map((r, i) =>
                Decoration.inline(r.from, r.to, {
                  class: i === editor.storage.searchAndReplace.resultIndex
                    ? `${searchResultClass} ${searchResultCurrentClass}`
                    : searchResultClass,
                })
              )
            );
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
