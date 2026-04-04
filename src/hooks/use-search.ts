import { useState, useCallback, useRef } from "react";

export function useSearch() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"find" | "replace">("find");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchTerm("");
    setDebouncedSearchTerm("");
    setReplaceTerm("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  const openSearch = useCallback((mode: "find" | "replace") => {
    setSearchOpen(true);
    setSearchMode(mode);
  }, []);

  const handleSearchTermChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchTerm(value);
    }, 150);
  }, []);

  const handleSearchResults = useCallback((count: number, index: number) => {
    setSearchResultCount(count);
    setSearchResultIndex(index);
  }, []);

  return {
    searchOpen,
    searchMode,
    setSearchMode,
    searchTerm,
    debouncedSearchTerm,
    replaceTerm,
    setReplaceTerm,
    searchResultCount,
    searchResultIndex,
    searchInputRef,
    openSearch,
    closeSearch,
    handleSearchTermChange,
    handleSearchResults,
  };
}
