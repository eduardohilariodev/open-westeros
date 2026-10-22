# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fans of A Song of Ice and Fire (readers and viewers) exploring the Known World. They spin the planet, search a place, fly to it and read about it. Contributors who add places, roads, rivers and 3D sites are a secondary audience.

## Product Purpose

Open Westeros is a community-built, Google Earth-style 3D atlas of the Known World of Ice and Fire. It lets people fly through Westeros and Essos instead of looking at a flat painted map, down to 3D sites such as King's Landing and Winterfell. Success is a fan finding a place and seeing it at honest scale.

## Positioning

A map you can fly through, built in the open on one planet at canon scale (radius 6,915 km, real metres). Canon sizes, distances and layouts come first, then well-argued fan reconstructions.

## Operating Context

- Vite + TypeScript + three.js app. The globe has a 3D relief view and a flat vector map; 3D sites are separate views.
- About 620 named places with symbols per kind, shown by camera height, searchable, with a card on click.
- Names for rivers and roads are lettered along their line.
- Generated data (relief, sites) is not in git. Deployment is a manual `npx vercel deploy --prod` from a machine that has it.

## Capabilities and Constraints

- Canon-first honesty: numbers say where they came from, and when canon is silent the product says so. Never invent facts.
- Open source (MIT) and public on Vercel. Code stays small and readable; a new site is a config entry, one view module and one data pipeline.
- Copyrighted art (GRRM's maps, game assets, mods) is never committed. Tools rebuild the atlas from users' own copies.

## Brand Commitments

Name: Open Westeros (SEO title: "Open Westeros: The Known World of Ice and Fire"). The manifesto in README.md is the voice reference: open, community, credit the makers.

## Evidence on Hand

- Live preview at open-westeros.vercel.app.
- README.md (manifesto), CONTRIBUTING.md, docs/ and the globe label rules in .claude/rules/globe-labels.md.
- Credits already shown in the UI: George R. R. Martin maps, Shadiversity / The True Winterfell SE, game-icons.net (CC BY 3.0), Abjiklam's Known World SVGs (CC BY-NC-SA 4.0).
- No testimonials, usage numbers or user research exist; do not fabricate any.

## Product Principles

1. Canon first, sources always: nothing on screen claims more than the books and official maps support.
2. Honest scale: size and distance are real, not tuned to look impressive.
3. Realistic over decorative: the globe reads as a place, not a cartoon (no heavy outlines, thin natural rivers).
4. Small, readable pieces: prefer the simplest thing that works.
5. Credit the makers: attribution stays attached to what they made.

## Accessibility & Inclusion

No product-specific requirement was established. Place-name colours need at least 4.5:1 against their white stroke (existing label rule).
