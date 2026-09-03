import type { JSONContent } from "@tiptap/core";

/**
 * Block-level three-way merge for Markdown documents.
 *
 * Documents are sequences of top-level blocks. Two edits of one base are
 * merged when they touch different blocks; both inserting at the same point
 * keeps both, ours first; anything that overlaps is a conflict. This is
 * diff3 over blocks, which is exactly the granularity a person or an agent
 * edits a note at.
 */

export type BlockKey = string;

export function blockKeys(blocks: JSONContent[]): BlockKey[] {
  return blocks.map((block) => JSON.stringify(block));
}

/** A run of `base[baseStart, baseEnd)` replaced by `other[otherStart, otherEnd)`. */
export interface Hunk {
  baseStart: number;
  baseEnd: number;
  otherStart: number;
  otherEnd: number;
}

function lcsTable(left: BlockKey[], right: BlockKey[]): Uint32Array[] {
  const rows: Uint32Array[] = [];
  for (let i = 0; i <= left.length; i += 1) rows.push(new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      rows[i][j] = left[i] === right[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  return rows;
}

/** Length of the longest common block subsequence; higher means more alike. */
export function commonBlockCount(left: BlockKey[], right: BlockKey[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  return lcsTable(left, right)[0][0];
}

/** Minimal edit hunks that turn `base` into `other`, in base order. */
export function diffHunks(base: BlockKey[], other: BlockKey[]): Hunk[] {
  const table = lcsTable(base, other);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) {
      hunks.push(open);
      open = null;
    }
  };
  while (i < base.length || j < other.length) {
    if (i < base.length && j < other.length && base[i] === other[j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    if (!open) open = { baseStart: i, baseEnd: i, otherStart: j, otherEnd: j };
    // Prefer consuming from base (a deletion) when it keeps the LCS, else from other.
    if (j >= other.length || (i < base.length && table[i + 1][j] >= table[i][j + 1])) {
      i += 1;
      open.baseEnd = i;
    } else {
      j += 1;
      open.otherEnd = j;
    }
  }
  close();
  return hunks;
}

export type MergeOutcome =
  | { kind: "clean"; merged: JSONContent[]; changedFromOurs: boolean; changedFromTheirs: boolean }
  | { kind: "conflict"; conflicts: number };

interface Region {
  start: number;
  end: number;
  ours: Hunk[];
  theirs: Hunk[];
}

function overlaps(region: Region, hunk: Hunk): boolean {
  if (hunk.baseStart < region.end) return true;
  // Pure insertions at the same point as an insertion-only region.
  return region.start === region.end
    && hunk.baseStart === hunk.baseEnd
    && hunk.baseStart === region.start;
}

function regionsOf(ours: Hunk[], theirs: Hunk[]): Region[] {
  const all = [
    ...ours.map((hunk) => ({ hunk, side: "ours" as const })),
    ...theirs.map((hunk) => ({ hunk, side: "theirs" as const })),
  ].sort((left, right) => left.hunk.baseStart - right.hunk.baseStart
    || (left.side === right.side ? 0 : left.side === "ours" ? -1 : 1));

  const regions: Region[] = [];
  for (const { hunk, side } of all) {
    const current = regions[regions.length - 1];
    if (current && overlaps(current, hunk)) {
      current.end = Math.max(current.end, hunk.baseEnd);
      current[side].push(hunk);
    } else {
      regions.push({
        start: hunk.baseStart,
        end: hunk.baseEnd,
        ours: side === "ours" ? [hunk] : [],
        theirs: side === "theirs" ? [hunk] : [],
      });
    }
  }
  return regions;
}

/** One side's version of a base region, with that side's hunks applied. */
function sideVersion(
  base: JSONContent[],
  other: JSONContent[],
  region: Region,
  hunks: Hunk[],
): JSONContent[] {
  if (hunks.length === 0) return base.slice(region.start, region.end);
  const out: JSONContent[] = [];
  let cursor = region.start;
  for (const hunk of hunks) {
    out.push(...base.slice(cursor, hunk.baseStart));
    out.push(...other.slice(hunk.otherStart, hunk.otherEnd));
    cursor = hunk.baseEnd;
  }
  out.push(...base.slice(cursor, region.end));
  return out;
}

export function mergeBlocks(
  base: JSONContent[],
  ours: JSONContent[],
  theirs: JSONContent[],
): MergeOutcome {
  const baseKeys = blockKeys(base);
  const ourKeys = blockKeys(ours);
  const theirKeys = blockKeys(theirs);
  const regions = regionsOf(diffHunks(baseKeys, ourKeys), diffHunks(baseKeys, theirKeys));

  const merged: JSONContent[] = [];
  let conflicts = 0;
  let cursor = 0;
  for (const region of regions) {
    merged.push(...base.slice(cursor, region.start));
    cursor = region.end;
    const ourVersion = sideVersion(base, ours, region, region.ours);
    const theirVersion = sideVersion(base, theirs, region, region.theirs);
    if (region.ours.length === 0) {
      merged.push(...theirVersion);
    } else if (region.theirs.length === 0) {
      merged.push(...ourVersion);
    } else if (blockKeys(ourVersion).join("\n") === blockKeys(theirVersion).join("\n")) {
      merged.push(...ourVersion);
    } else if (region.start === region.end) {
      // Both inserted at the same point: keep both, ours first.
      merged.push(...ourVersion, ...theirVersion);
    } else {
      conflicts += 1;
    }
  }
  if (conflicts > 0) return { kind: "conflict", conflicts };
  merged.push(...base.slice(cursor));

  const mergedKeys = blockKeys(merged).join("\n");
  return {
    kind: "clean",
    merged,
    changedFromOurs: mergedKeys !== ourKeys.join("\n"),
    changedFromTheirs: mergedKeys !== theirKeys.join("\n"),
  };
}

/**
 * Pick the candidate an external write was most likely based on: the one
 * sharing the most blocks with it. Ties go to the latest candidate.
 */
export function chooseMergeBase<T extends { blocks: JSONContent[] }>(
  candidates: T[],
  theirs: JSONContent[],
): T | null {
  if (candidates.length === 0) return null;
  const theirKeys = blockKeys(theirs);
  let best: T | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = commonBlockCount(blockKeys(candidate.blocks), theirKeys);
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
