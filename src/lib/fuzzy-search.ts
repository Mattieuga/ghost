export interface FuzzyResult<T> {
  item: T;
  score: number;
}

/**
 * Score a query against a target string.
 * Returns 0 for no match, higher is better.
 *
 * Bonuses: exact prefix, word-boundary match, consecutive chars.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return 0;
  if (t.startsWith(q)) return 1000 + q.length; // exact prefix is best

  let score = 0;
  let qi = 0;
  let consecutive = 0;
  let lastMatchIndex = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      // Consecutive match bonus
      if (ti === lastMatchIndex + 1) {
        consecutive++;
        score += consecutive * 3;
      } else {
        consecutive = 0;
        score += 1;
      }
      // Word-boundary bonus (start of string, after separator)
      if (ti === 0 || /[/\-_.\s]/.test(t[ti - 1])) {
        score += 5;
      }
      lastMatchIndex = ti;
    }
  }

  // All query chars must match
  if (qi < q.length) return 0;

  return score;
}

/**
 * Fuzzy-search a list of items, returning scored results sorted best-first.
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 20
): FuzzyResult<T>[] {
  if (!query) return [];

  const results: FuzzyResult<T>[] = [];

  for (const item of items) {
    const score = fuzzyScore(query, getText(item));
    if (score > 0) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
