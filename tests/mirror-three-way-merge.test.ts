import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  chooseMergeBase,
  commonBlockCount,
  diffHunks,
  blockKeys,
  mergeBlocks,
} from "../src/lib/mirror/three-way-merge";

function p(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function texts(blocks: JSONContent[]): string[] {
  return blocks.map((block) => block.content?.[0]?.text ?? "");
}

const base = [p("A"), p("B"), p("C"), p("D")];

describe("diffHunks", () => {
  it("finds a replacement, an insertion, and a deletion in base coordinates", () => {
    const other = [p("A"), p("B2"), p("C"), p("X"), p("D")];
    expect(diffHunks(blockKeys(base), blockKeys(other))).toEqual([
      { baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 2 },
      { baseStart: 3, baseEnd: 3, otherStart: 3, otherEnd: 4 },
    ]);
    expect(diffHunks(blockKeys(base), blockKeys([p("A"), p("C"), p("D")]))).toEqual([
      { baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 1 },
    ]);
    expect(diffHunks(blockKeys(base), blockKeys(base))).toEqual([]);
  });
});

describe("mergeBlocks", () => {
  it("merges edits to different blocks from both sides", () => {
    const ours = [p("A"), p("B mine"), p("C"), p("D")];
    const theirs = [p("A"), p("B"), p("C"), p("D theirs"), p("E theirs")];
    const result = mergeBlocks(base, ours, theirs);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B mine", "C", "D theirs", "E theirs"]);
    expect(result.changedFromOurs).toBe(true);
    expect(result.changedFromTheirs).toBe(true);
  });

  it("is a plain replace when ours equals base", () => {
    const theirs = [p("A"), p("B2"), p("C"), p("D")];
    const result = mergeBlocks(base, base, theirs);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B2", "C", "D"]);
    expect(result.changedFromTheirs).toBe(false);
  });

  it("restores our edits when the other side wrote back a stale copy", () => {
    const ours = [p("A"), p("B mine"), p("C"), p("D")];
    const result = mergeBlocks(base, ours, base);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B mine", "C", "D"]);
    expect(result.changedFromOurs).toBe(false);
    expect(result.changedFromTheirs).toBe(true);
  });

  it("conflicts when both sides change the same block differently", () => {
    const ours = [p("A"), p("B mine"), p("C"), p("D")];
    const theirs = [p("A"), p("B theirs"), p("C"), p("D")];
    expect(mergeBlocks(base, ours, theirs)).toEqual({ kind: "conflict", conflicts: 1 });
  });

  it("takes an identical change from both sides once", () => {
    const same = [p("A"), p("B same"), p("C"), p("D")];
    const result = mergeBlocks(base, same, same);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B same", "C", "D"]);
  });

  it("keeps both insertions at the same point, ours first", () => {
    const ours = [...base, p("mine at end")];
    const theirs = [...base, p("theirs at end")];
    const result = mergeBlocks(base, ours, theirs);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B", "C", "D", "mine at end", "theirs at end"]);
  });

  it("conflicts when one side deletes a block the other edited", () => {
    const ours = [p("A"), p("C"), p("D")];
    const theirs = [p("A"), p("B edited"), p("C"), p("D")];
    expect(mergeBlocks(base, ours, theirs).kind).toBe("conflict");
  });

  it("handles adjacent changes as separate regions", () => {
    const ours = [p("A"), p("B mine"), p("C"), p("D")];
    const theirs = [p("A"), p("B"), p("C theirs"), p("D")];
    const result = mergeBlocks(base, ours, theirs);
    expect(result.kind).toBe("clean");
    if (result.kind !== "clean") return;
    expect(texts(result.merged)).toEqual(["A", "B mine", "C theirs", "D"]);
  });
});

describe("chooseMergeBase", () => {
  it("picks the generation the external write shares the most blocks with, latest on ties", () => {
    const older = { id: "older", blocks: [p("A"), p("B"), p("C")] };
    const latest = { id: "latest", blocks: [p("A"), p("B mine"), p("C")] };
    const staleRewrite = [p("A"), p("B"), p("C"), p("agent added")];
    expect(chooseMergeBase([older, latest], staleRewrite)?.id).toBe("older");
    expect(chooseMergeBase([older, latest], [p("A"), p("B mine"), p("C"), p("new")])?.id).toBe("latest");
    expect(chooseMergeBase([older, latest], [p("Z")])?.id).toBe("latest");
    expect(chooseMergeBase([], [p("A")])).toBeNull();
    expect(commonBlockCount(blockKeys(older.blocks), blockKeys(latest.blocks))).toBe(2);
  });
});
