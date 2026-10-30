# 0001 Fill lore gaps with realism, not blanks

Date: 2026-10-27. Status: accepted (the project owner's direction).

## Context

The books give almost no numbers for terrain. The heights we baked broke the two that exist (the Giant's Lance 3.5 mi above the Vale, the Bones the tallest range
of the known world), and everything else was a guess nobody had written down. The old rule, "where all sources are silent, say canon is silent and keep it",
leaves a value with no basis.

## Decision

Check lore first, always. Where it has no proper number, use the best assumption from nature's rules, maths and a real-world equivalent; when in doubt,
artistic interpretation and realism decide. Every such value is written down as an `assumption` with its analogue and reason, beside the lore claims it must not
contradict (`tools/books/range-heights.json`), and a lore claim fails the terrain run while an assumption only warns.

## Alternatives

- Keep canon-first for everything (silent means keep): rejected, nothing can be drawn where canon has no figure.
- Pure artistic freedom with no table: rejected, it hides which values are canon and which are ours.

## Scope

Positions and relations (a place on a river, a distance) stay canon-first: silent means keep. This rule is for magnitudes and looks (height, width, depth, slope, colour, texture).
