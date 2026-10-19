# Design assets

## `landing-page-mockup.html`

The approved design for the public landing page (Phase 2 Step 5). Open it in a browser: it is a single
self-contained file with no dependencies, and it is interactive — the feature tabs work and the header
carries a theme toggle, so both light and dark can be checked without editing anything.

It was the source of truth for the landing page's visual design, not a sketch, and it has since been
built: the live pages are `client/src/pages/LandingPage.tsx`, `PricingPage.tsx`, `FaqPage.tsx` and
`client/src/pages/landing/`. **From Step 6g it is a record rather than a reference** — it is not maintained
in parallel, the copy has moved on, and it still carries the old name and the old mark deliberately. When
the two disagree now, the live pages win. Every colour in it comes
from `client/src/index.css`, and the five product shots were built by reading the real components
(`RosterView`, `EntryView`, `GroupsCanvas`, `Wheel`, `ComposeView`) rather than by approximation.

Scroll past the page itself for the **design notes**: the rationale, the logo directions with the selected
mark, and the departures from [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) that were raised and approved.

### What was approved

- **Logo:** direction A, the protractor toolkit. A pencil and a ruler fanning out of a protractor, standing
  in for the handle of a pocket knife. Replaces the placeholder graduation cap. The mark is inline SVG
  (`#mk-a` in the file) and uses design tokens, so it follows the theme. **Superseded at Step 6g** — the pun
  was on the old name. See [brand/README.md](brand/README.md) for what replaced it.
- **Three additions to DESIGN_SYSTEM**, all marketing-scoped and none in conflict with the existing spec:
  1. **Two display type steps** above the app's 24px ceiling — `display-lg` (clamps 34–52px) and
     `display-md` (24–32px), weight 600 with negative letter-spacing.
  2. **A fourth ground colour, `--canvas`** (`#fffdf7` light, `#1d1b17` dark) for the hero and closing
     bands. A neutral biased toward the accent hue, so a full-width band separates from the content around
     it without spending the accent on decoration. Also a candidate for the app.
  3. **48px buttons** for marketing calls to action, against the app's 36px. Not to be carried into the app.

### Worth borrowing in the app

The roster row in the mockup collapses using a **container query** rather than a viewport media query,
because the row has to respond to the width it actually sits in. The real roster uses an `sm:` breakpoint,
but it lives in a content area whose width depends on the sidebar state, which a viewport query cannot see.

### Product shots are DOM, not images

Every screenshot on the page is HTML and CSS. This was forced rather than chosen: a real capture of a roster
would contain real student names, which is indefensible for a product whose entire claim is that it never
holds student data. Since any shot must use fabricated data regardless, rendering it in DOM costs nothing
and gains theme-following and immunity to token drift. The trade is that the shots are a representation of
each tool maintained separately from the real component, so they are close rather than pixel-exact.

## `design1.PNG`, `design2.PNG`

Gmail and Google Drive in dark mode. The visual reference the app's own language was derived from, noted at
the top of [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md). Not screenshots of this product.
