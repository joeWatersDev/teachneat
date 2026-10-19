# Teachneat brand assets

Three official brandings, settled at the Step 6g review. Everything in this
folder except this file and `generate.py` is **generated output** — do not edit
an asset by hand. Change the constants in `generate.py` and re-run:

```bash
py design/brand/generate.py
```

**These files are wired into the application.** `client/src/components/ui/Logo.tsx`
redraws the mark from design tokens rather than importing `mark.svg`, and
`Wordmark.tsx` holds the wordmark and the lockup; the icon crop is copied into
`client/public/`. A change here is a change there — the geometry is duplicated in
`Logo.tsx` on purpose, so that the mark can take theme tokens instead of the
literal colours a static file has to bake in.

---

## 1. The mark

Three books on a shelf: two leaning toward one standing square, each carrying
the panel a title is stamped into. It replaces the pencil-ruler-protractor
multi-tool, which was a visual pun on "Teacher Toolkit" and stopped meaning
anything at the rename.

| Property | Value |
|---|---|
| Grid | 32 × 32, the same grid every icon in the app uses |
| Spine | 5.5 wide, 17 tall (y10 → y27), corner radius 1.3 |
| Gap between spines | 3.25 |
| Lean angles | **25°** and **12°**, clockwise, about the point each book stands on |
| Title panel | inset 0.9 each side, spanning 22% to 52% of the spine's height, radius 0.5 |
| Colours | leaning books a grey pair per mode; upright book `--color-accent` |
| Spine colours | opaque greys per mode, **not** one colour at two opacities — see below |
| Panel | white at 38%, over the spine |

**All three books are the same size.** Varying their heights and widths was
tried and rejected: it says "books" more loudly, and it costs the reading of
three identical objects, which is where the mark started.

The angles are the rest of the design. Below about 15° the lean stops being
visible at 16px; past about 25° the leading book reads as fallen rather than
leaning.

**The upright book takes the accent, and it is the only element that does.** The
mark says the tidy one is holding the others up, so the accent belongs on it.

**The spines are opaque greys, not one colour at two opacities.** They were the
latter until the shades were found to move, and the change is worth stating as a
rule rather than a value: **opacity is not a shade.** It composites against
whatever sits behind the mark, which has two consequences, both of which shipped
as bugs before they were understood.

- **The mark rendered differently on every surface.** At 55%, the back book
  measured 167 of 255 on the white top bar, 161 on the sidebar, 157 on a hover
  row and 167 on the marketing canvas. A logo has one set of colours.
- **The ordering inverted between modes.** Fading moves a book toward the
  ground, and the ground changes sides, so the pair that made the back book the
  palest of the three on white made it the darkest on a dark tab strip.

The greys are the composites the opacity form produced against the ground each
mode was designed for, so the mark is unchanged where it was already right:

| | Back (25°) | Middle (12°) | Upright |
|---|---|---|---|
| Light | `#a7a9ac` | `#7f8286` | `#ffab00` |
| Dark | `#9aa0a6` | `#6c7075` | `#ffab00` |

Back is palest in both. They are still **derived** rather than picked —
`books()` in `generate.py` mixes the mode's secondary text colour toward the
mode's ground, at ratios that are themselves mode-dependent for the reason
above — which is the one thing the opacity form was actually buying. The values
are **mirrored as `--logo-book-back` / `--logo-book-mid` in
`client/src/index.css`** under `:root` and `.dark`; change both.

Only the title panel is still translucent, and that is safe because it
composites against the spine rather than against the page.

**The panel lightens the board rather than darkening it.** That matters most on
the accent, where a dark panel reads as a shadow falling across the book and a
light one reads as something printed on it.

**The panel sits inside the book's own group, so it composites against the
spine.** That is what makes it safe to leave translucent once the spines are
opaque: it lightens the board rather than showing the page through it. It is
also why `generate.py` composites the panel onto its own layer before drawing —
Pillow's `ImageDraw` replaces pixels rather than blending them, so a translucent
panel drawn straight onto the spine punches a hole in it.

**The panel is gone below about 32px, by design rather than by accident.** It is
a 5.1-unit mark on a 32-unit grid, so a 16px favicon has no room for it and the
mark degrades to three plain leaning spines — which is the version it started as
and a perfectly good small mark.

### Files

| File | Use |
|---|---|
| `mark.svg` | Design-token colours. The reference for `Logo.tsx`. |
| `mark-light.svg`, `mark-dark.svg` | Literal colours, for contexts with no tokens: email, slides, a listing form. |
| `mark-{16..512}.png` | Raster, transparent, positioned as it sits in a lockup. |
| `mark-dark-{32,192,512}.png` | The same for dark grounds. |

## 2. The icon crop

**Same artwork, cropped to its own ink and squared.** Not a second logo.

The books stand on a baseline inside the 32 box rather than filling it, and
tipping two of them pushes ink further still, so the drawn area covers a bit
over half the frame's height. That is correct in a lockup, where the mark has to
sit on the same line as type. It is wrong in an icon slot, where it throws away
resolution a 16px favicon cannot spare.

**Use the icon crop for every square slot** — favicon, app icon, avatar, the
Workspace Marketplace listing — and the uncropped mark everywhere else.

| File | Use |
|---|---|
| `favicon.svg` | Cropped, and switches its own colour **and lean opacities** on `prefers-color-scheme`. |
| `favicon.ico` | 16/32/48/256 in one file, for the slot that still wants it. |
| `icon-{16..512}.png` | Cropped raster, transparent. Avatars, and anywhere the ground is known. |
| `icon-dark-{32,192,512}.png` | The same for dark grounds. |
| `app-icon-{120,180,192,512}.png` | Cropped, on a solid ground. Installed-app slots and listing forms; 120 is the Google OAuth consent screen logo. |
| `app-icon-maskable-{192,512}.png` | The same, padded for Android's maskable crop. |

### The ground question, settled

**A square icon sits on a solid ground everywhere except the browser tab.** A
transparent icon lands on whatever the host decides, and for apple-touch-icon
that is black — where two mid greys chosen against a light ground have far too
little contrast. The tab is the exception because there the host ground is the
browser's own chrome and `favicon.svg` switches its greys to suit.

- **The ground is `#fffdf7`**, the app's light canvas, so the icon matches the
  page it opens rather than sitting on a white tile the product never shows.
  It does not follow the theme: a home-screen icon has no theme to follow.
- **No corner radius is baked in.** iOS and every Android launcher apply their
  own mask, and a rounded tile inside a rounded mask reads as a double border.
- **Two art sizes, because the two slots crop differently.** A plain icon is
  shown whole, so the art fills 78% of the tile. A maskable one is cropped to
  whatever shape the launcher wants and is guaranteed only the centre circle of
  80% diameter; a square fits that circle at 0.8/√2, so the art fills 56% and
  the extra padding is a requirement rather than taste.

The Marketplace listing (Step 9) takes `app-icon-512.png`, not the transparent
crop.

## 3. The wordmark

"Teachneat" set in the system font stack, with a weight split across the join:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
letter-spacing: -0.02em;
/* "Teach" */ font-weight: 650;
/* "neat"  */ font-weight: 400;
```

**The CSS above is canonical, not the SVG files.** This project uses no custom
font by design, so the wordmark has no fixed outline: it is type, set live, and
it resolves differently per machine on purpose. `wordmark-{light,dark}.svg`
exist for contexts that need a file, and they carry the same font stack rather
than converted outlines — outlining would freeze one machine's Segoe UI into an
asset the CSS would then disagree with.

Their `viewBox` widths are estimates for the same reason. **Scale a wordmark or
lockup SVG by height, never by width.**

Do not colour "neat" in the accent. The accent is a mode-invariant gold and
fails WCAG AA as text at body sizes against both backgrounds.

## 4. The lockup

Mark and wordmark together, horizontally, vertically centred.

One rule rather than three numbers — at a mark of size **M**:

| Element | Size |
|---|---|
| Mark | M |
| Type | 0.625 M |
| Gap | 0.25 M |

At the 32px both headers use, that is **20px type and an 8px gap**.

**The gap is measured box to box, not ink to ink.** The mark's box is 32 wide
while its ink starts at x4.5, so the visible whitespace runs a little wider than
the number. That is the convention the lockup was chosen under and changing it
would silently reopen the decision.

| File | Use |
|---|---|
| `lockup-{32,56,72}-{light,dark}.svg` | Header, hero, and display sizes. |

### When to use which

- **Lockup** — marketing header, hero, anything print or external where the
  product is being introduced.
- **Mark alone** — the app top bar beside the existing text, tabs, avatars, any
  square slot, anywhere the name is already on the page.
- **Wordmark alone** — footers, body copy, a signature line, anywhere a mark
  would be decoration.
