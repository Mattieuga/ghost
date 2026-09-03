---
title: "Ghost Typography & Markdown Showcase"
subtitle: "A repeatable document for comparing fonts, spacing, and round trips"
draft: false
tags: [typography, markdown, testing]
display:
  preferred_width: 730
  sample_line_height: 1.65
# Comments, ordering, quotes, and whitespace should survive edits.
---

# Typography & Markdown Showcase

Use this document to compare typefaces, editor widths, line heights, and block spacing. A good configuration should make the structure obvious before you consciously identify any formatting.

## Continuous reading

Good typography disappears during reading. The shapes remain distinct, the measure feels comfortable, and your eyes can move from the end of one line to the beginning of the next without searching. Short paragraphs should feel related; separate ideas should have enough space to register as separate ideas.

This second paragraph tests the distance between adjacent blocks. It contains **bold emphasis**, *quiet italics*, ~~struck text~~, `inline code`, and [a descriptive link](https://example.com/typography?mode=reading&size=16). None of those treatments should disturb the color of the paragraph.

### Punctuation and texture

“Smart quotes,” apostrophes, commas, semicolons; colons: em dashes—en dashes–ellipses… and parentheses (like these) should remain clear without creating dark spots. Prices such as $1,234.56, percentages such as 99.9%, and dates such as 2026-08-18 should align naturally with prose.

Literal notation should remain literal after a save: [unclear: verify this], ~1/2 cup, a_b, file*.md, and `{ value: true }`.

## Character differentiation

These strings expose fonts whose similar glyphs are too difficult to distinguish:

| Category | Comparison string |
| --- | --- |
| Ones and verticals | `I l 1 i | !` |
| Rounds | `O 0 o Q C G 6 8 9` |
| Joined shapes | `rn m`, `cl d`, `vv w`, `ce œ` |
| Brackets | `() [] {} <> / \\` |
| Code identifiers | `userID`, `userId`, `user_id`, `User1O0l` |

The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. Sphinx of black quartz, judge my vow.

## Heading hierarchy

Each level should be recognizable without becoming louder than the content it organizes.

### Heading level three

Level-three headings are common in working notes and should remain strong at a relatively small size.

#### Heading level four

Level four should feel like a label inside the current section, with clear space before and modest space after.

##### Heading level five

Small headings still need enough weight and contrast to differ from bold paragraph text.

###### Heading level six

The final level should remain useful rather than collapsing into an indistinct bold line.

## Lists and wrapping

- **First principle:** related list items should feel like one group.
- A short unformatted item provides a neutral baseline.
- A longer item tests wrapping and hanging indentation because its continuation line should align with the text—not with the bullet—and remain easy to find when the editor width changes.
  - Nested items need a visible but restrained second-level marker.
  - Another nested item checks the spacing inside the parent group.
    - A third level should still be understandable.
- The final item reveals how much space appears after the complete list.

1. **Begin with structure.** Readers scan headings, emphasized phrases, and the left edge before reading every word.
2. **Control the rhythm.** Keep lines within a block relatively close while separating complete thoughts with deliberate space.
3. **Test real content.** A typeface that looks beautiful in a specimen may become tiring across notes, links, code, and dense lists.

- [ ] Unchecked task with ordinary text
- [x] Completed task with **important context**
- [ ] Task long enough to wrap onto a continuation line and expose checkbox alignment at the selected font size

## Quotations and code

> Typography is the interface between language and attention.
>
> A second paragraph tests spacing inside a multi-paragraph quotation and the transition back into normal text.

Inline Swift should read clearly: `let result = values.map(\.name)`.

```swift
struct ReadingPreferences: Codable {
    var fontFamily = "Avenir Next"
    var fontSize = 16
    var lineHeight = 1.65
    var blockSpacing = 1.25
}
```

## International text and symbols

Latin accents: naïve, façade, coöperate, piñata, São Paulo, Ångström, smörgåsbord.

Other scripts and fallback behavior: Ελληνικά · Кириллица · العربية · עברית · हिन्दी · 日本語 · 한국어 · 中文.

Symbols: → ← ↑ ↓ • ◦ ◆ ◇ ✓ ✕ ★ ☆ © ™ ° ± × ÷ ≈ ≠ ≤ ≥ ∞.

## Links, media, and long measures

Automatic URL styling should remain visible without overwhelming the sentence: <https://developer.apple.com/design/human-interface-guidelines/typography>.

A deliberately long unbroken value tests overflow behavior: `com.example.ghost.typography.showcase.preferences.continuousReading.maximumComfortableMeasure`.

![Ghost application icon](../../src-tauri/icons/128x128.png "Ghost icon at its natural size")

---

**Final visual check**

At a glance, can you find the title, major sections, list boundaries, quotation, code sample, table, and final note? If so, the typography is doing its job.
