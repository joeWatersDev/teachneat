# Teachneat — Design System

Visual language and UX specifications for Teachneat. Informed by Google Drive and Gmail dark mode as reference points.

---

## Layout

The app uses a three-zone layout. All three zones are visible at all times on desktop. The sidebar collapses on smaller viewports.

```
┌──────────────────────────────────────────────────────┐
│  Wordmark                               [🌙/☀] [👤] │  ← Top Bar
├────────┬─────────────────────────────────────────────┤
│        │  (Tool-specific controls, case by case)     │  ← Tool Toolbar
│  Nav   │─────────────────────────────────────────────│
│  Items │                                             │
│        │           Main Content Area                 │
│        │                                             │
│        │                                             │
│        │                                             │
│        │                                             │
├────────┴─────────────────────────────────────────────┤
│  Subscription status                                 │  ← Sidebar Footer
└──────────────────────────────────────────────────────┘
```

### Top Bar
- **Height:** 64px
- **Position:** fixed, spans full width, sits above both sidebar and content
- **Left region:** the logo mark followed by the wordmark "Teachneat". See **Logo** below.
- **Right region:** light/dark mode toggle switch, user avatar (pulls Google profile photo). Clicking the avatar opens a dropdown with account info and logout.
- **No settings gear.** One was drawn in the original layout and removed once it was clear nothing would live behind it: the single server-applied setting (the high-absence threshold) belongs contextually on the Attendance page where the flag it governs appears, display and styling options live in their own tools' modals, the theme has its own top-bar control, and everything account-shaped — plan, billing, support, sign-out — is in the avatar menu. Reintroduce it only when there is a settings surface that genuinely belongs nowhere else.
- **Every item in the account menu carries a leading icon** at 14px, so the list reads as one column rather than a mix of labelled and unlabelled rows. The development-only plan toggle takes one too (a flask): with every other item iconed, having none is what would draw the eye to it, which is the opposite of the intent.
- **The account menu carries navigation only (Phase 2 Step 6f).** In order: Upgrade to Premium (unless the
  account is `paid`, and absent entirely while `billingEnabled` is false — Step 8a), Account settings, Getting started, Help and support, then the operator-only triage
  item, the development-only plan toggle, and Sign out. Nothing on it acts on the account directly — billing
  moved to the Account settings page, and the two destructive actions added in 6f were never candidates for
  it. **A dropdown is the wrong container for an irreversible action:** it is small, it is dismissed by a
  click anywhere outside it, and it has no room to say what a control does before it is clicked.
- **Getting started is conditional.** It appears only while the account has no student (`hasStudents ===
  false` from `GET /auth/me`), so the first-run guide is a first-week affordance rather than a permanent
  item. The check is explicitly against `false`: a profile that omits the field must leave the item hidden
  rather than let `undefined` decide.
- **The menu opens with the account's name and email**, then a separator, then the items above. In development only, a plan toggle sits above Sign out reading the current state ("Plan: trial — switch to paid"), cycling `free` → `trial` → `paid`. It renders only when `GET /auth/me` reports `devTools: true`, is styled as an ordinary menu item with no accent or badge so it is never mistaken for product UI, and does not exist in production builds' reachable API. Its purpose is checking premium presentation across all three plan states without leaving the page.
- No search bar. The app's data sets are small enough (a single teacher's students) that in-tool filtering is sufficient.

### Sidebar
- **Width:** 220px, fixed position, full height below the top bar
- **Background:** one step lighter than the main content area to create a subtle visual separation without a hard border
- **Contents:**
  - Navigation items, one per tool. Each item has an icon and a label.
  - Navigation order (fixed): Students, Attendance, Grouping, Name Picker, Email
  - If automated attendance communications are ever built (a Phase 3 candidate), the queued-for-review count is an inline badge on the **Email** item, not the Attendance one and not a separate notification icon in the top bar. The badge moved with the interface, which that feature's decisions place in the Email tool as its own tab. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3.
  - Active item is highlighted with the accent color (gold/yellow text or a left-edge indicator bar, not a full background fill that would overuse the accent)
  - Hover state: subtle background lightening
- **Footer area:** the account's plan ("Free plan", "Free trial — full access", "Paid plan"), equivalent to Drive's storage usage bar. On any plan other than `paid` it also carries the **premium star legend** — a star followed by "Paid plan feature" or "Included until your trial ends" — which is the one place the star marking gated controls is explained (see Premium feature affordance). Both lines hide at the icons-only sidebar width, where there is no room for text.
  **Step 8a removes the footer entirely while `billingEnabled` is false**, border included: every line in
  it states something about a boundary that does not exist, and an emptied block would be a rule drawn
  across the sidebar with nothing under it. It returns whole with billing.
- **Collapse behavior:** on viewports below 1024px, the sidebar collapses to icons only (~64px). Below 768px, it becomes a slide-out drawer toggled by a hamburger icon in the top bar.

### Main Content Area
- **Fills all remaining space** to the right of the sidebar and below the top bar
- **Tool toolbar:** a horizontal strip at the top of the content area (below the top bar) containing controls specific to the active tool. Each tool defines its own toolbar layout and controls (there is no universal toolbar template). This toolbar scrolls away with the content on long pages, unlike the top bar which stays fixed.
- **Default landing page:** the Students page. No separate dashboard view.
- **Content region:** the tool's primary interface. Scrollable independently.
- **Max content width:** 1200px, centered, with horizontal padding. Prevents content from stretching unreadably wide on ultrawide monitors.

### Logo

**Decided at Step 6g and specified in full in [design/brand/README.md](design/brand/README.md), which is
authoritative for geometry, sizes and file names.** What follows is the part a designer working in this
system needs to know without opening that file.

**The assets are in the application.** [Logo.tsx](client/src/components/ui/Logo.tsx) draws the book mark
from design tokens, and [Wordmark.tsx](client/src/components/ui/Wordmark.tsx) carries the wordmark and the
lockup of the two. The wordmark is a component rather than a plain string because the weight split needs
two elements and 650 is not a Tailwind weight step; it sets no colour of its own so a footer can keep it in
the same grey as the sentence around it. The icon crop is in `client/public/` and wired from
`index.html` (SVG, `.ico`, apple-touch-icon and a web app manifest).

There are three brandings, plus one crop:

- **The mark** — three books on a shelf, two leaning at 25° and 12° toward one standing square, each
  carrying the lightened panel a title is stamped into. All three are the same size; varying their heights
  and widths was tried and rejected, because it says "books" more loudly at the cost of the three-identical-
  objects reading the mark started from. The angles are the rest of it: below about 15° the lean is
  invisible at 16px, and past about 25° the leading book reads as fallen rather than leaning.
- **The wordmark** — "Teachneat" in the system stack, `letter-spacing: -0.02em`, with a weight split across
  the join: 650 on "Teach", 400 on "neat". **The CSS is canonical, not any SVG file.** This project ships no
  custom font by design, so the wordmark has no fixed outline and is set live.
- **The lockup** — both together, horizontally, vertically centred, as one rule: at a mark of size M the
  type is 0.625M and the gap is 0.25M, measured **box to box**. At the 32px both headers use, that is 20px
  type and an 8px gap.
- **The icon crop** — the same mark squared to its own ink, for favicons, app icons and avatars. The books
  stand on a baseline rather than filling the frame, which is right beside type and wrong in a square slot,
  where it throws away resolution a 16px favicon cannot spare.

Constraints that hold whatever changes:

- **Colours are tokens, not literals**, so the mark follows the theme. The upright book takes the accent
  and is the only element that does — the mark says the tidy one is holding the others up, so that is where
  the accent belongs. The two leaning books take a grey pair, `--logo-book-back` / `--logo-book-mid`, which
  separates them from each other without introducing a third hue.
- **That pair is opaque, and deliberately not one colour at two opacities.** **Opacity is not a shade:** it
  composites against whatever is behind the element, so a faded grey renders differently on the top bar,
  the sidebar and a hover row (167, 161 and 157 of 255, as the mark shipped), and its ordering *inverts*
  between modes, because fading moves a shape toward the ground and the ground changes sides. Both of those
  reached production before they were understood. **Any element that separates itself by opacity alone has
  this problem**, and catching it means compositing against every real background rather than viewing it
  on white.
- **Detailing lightens the spine rather than darkening it**, and it lives inside the book's own group so it
  composites against the spine before the group's opacity is applied. Both halves of that matter: a dark
  panel on the gold reads as a shadow falling across the book rather than as something printed on it, and a
  panel painted outside the group shows the page through it instead of lightening the board.
- **The panel is gone below about 32px, deliberately.** It is a 5.1-unit mark on a 32-unit grid, so the mark
  degrades at icon sizes to three plain leaning spines — which is what it was before the panel, and a
  perfectly good small mark. Any detailing added later has to degrade the same way.
- **Never colour the wordmark's second half in the accent.** The accent is a mode-invariant gold and fails
  WCAG AA as text at body sizes against both backgrounds.
- **One component per branding**, so no two surfaces can drift. The lockup serves the app top bar, the
  marketing header and the consent screen; the mark alone serves the landing hero, where the name is
  already in the header above it; the wordmark alone serves the marketing footer, where a mark would be
  decoration beside body copy.
- **Sizes:** 32px in both headers, 56px in the landing hero, legible at 16px in a browser tab.
- The mark is decorative wherever the wordmark sits beside it, so it renders `aria-hidden` unless given a
  `title`.

**What it replaced, and why.** Phase 1 carried a graduation-cap placeholder. Step 5 replaced that with a
pencil and ruler fanning out of a protractor standing in for a pocket-knife handle — a multi-tool, and a
direct visual pun on "Teacher Toolkit". The pun stopped landing at the rename. The counter-argument was
real and was tested over five review rounds: the pocket-knife reading was the *design rationale* rather than
something a viewer decodes, so the rename arguably made the reasoning stale rather than the drawing wrong.
It lost on a different point. "Teachneat" claims the administrative side of teaching kept tidy, and the
book mark draws that claim, while the old mark illustrated a word that is no longer in the name.

Two findings from those rounds are worth keeping, because they generalise beyond this mark:

- **An N built from three bars needs its diagonal to meet the stems.** A rotated rectangle floating in the
  gap leaves two vertical slots and reads as three objects rather than a letter. A letter's diagonal starts
  flush with the whole top of one stem and finishes flush with the whole bottom of the other, which makes
  the counters triangular. An N was explored at length as a monogram and set aside: opening the joints
  enough to read as separate items is exactly what stops it reading as a letter.
- **Rounded terminals and a colour break both say "separate objects".** That is why the book mark uses
  both and why a letterform cannot.

### The Public Shell (Phase 2 Step 5)

Everything above describes the app a signed-in teacher works in. The signed-out pages — landing, pricing,
contact, privacy, terms — use a **separate layout**, not the app shell, and the difference is deliberate
rather than incidental.

- **No sidebar and no fixed top bar.** The sidebar is a list of five tools; for a visitor there is no roster
  to navigate and no tool to be in. The public shell is an ordinary scrolling document: a 64px header with
  the wordmark, Pricing and Contact links, the theme toggle, and a sign-in button, and a footer carrying
  those links plus Privacy and Terms.
- **Max content width 5xl (~1024px)**, narrower than the app's 1200px, because these pages are prose and
  card grids read across rather than dense tables read down.
- **The theme toggle appears here too.** The theme is app-wide and persisted, so a visitor who prefers dark
  and then signs in should not watch the product change appearance on them at the moment they commit to it.
- **Sign-in is an anchor, not a button with a handler.** It is a full navigation to the server's OAuth
  route, so an anchor gets middle-click, open-in-new-tab, and a visible target for free. Variant and size
  are props rather than an appended className, so which background wins is never left to CSS source order.
- **Accent use is unchanged:** check icons take the accent as an icon colour, and the accent is still
  never a body-text colour. The pricing page's accent-bordered Premium card went with the tier comparison
  in Step 8a; if a paid tier returns, so does that treatment.
- **Routes:** `/` (landing, rendered when signed out), `/pricing`, `/faq`, `/contact`, `/privacy`,
  `/terms`, `/for-admins` (Step 5a), and `/help/your-data` (Step 6f). Header navigation is Pricing, FAQ,
  Contact plus Sign in; the footer adds For school administrators, Privacy and Terms.
- **Five of these carry a session probe** (Step 6f): `/faq`, `/contact`, `/privacy`, `/terms` and
  `/help/your-data` are linked from inside the app, so their header asks whether a session exists and offers
  "Back to the app" instead of "Sign in". The landing and pricing pages deliberately do not probe, which is
  what keeps a visitor deciding whether to sign up free of a round trip.
- **`/for-admins` is in the footer but not the header, deliberately.** Its reader is a school IT
  administrator — neither the visitor the header is designed for nor someone who browses to it, since they
  arrive from a link a blocked teacher sent them. A footer entry gives it a permanent, linkable home without
  spending a main-nav slot on an audience of roughly one person per school. It is public for a reason
  specific to it: a page about being unable to sign in must not itself require signing in.

**Three additions to the system, marketing-scoped.** Each fills a gap rather than contradicting a rule, and
none is used inside the app.

1. **Two display type steps** above the app's `xl` (24px) ceiling, which is right for a dense tool and far
   too small for a landing headline. `display-md` is `clamp(24px, 3.4vw, 32px)` and `display-lg` is
   `clamp(34px, 6vw, 52px)`, both weight 600 with negative letter-spacing (-0.015em and -0.022em). The
   tracking is what keeps a system font stack from reading loose at those sizes.
2. **A fourth ground, `--color-canvas`** (`#fffdf7` light, `#1d1b17` dark), for the hero and closing bands.
   The four existing grounds are all neutral grey; two full-width bands using the same white as the content
   between them would leave the page flat, and `accent-muted` would break the rule against decorative
   accent. This is a neutral pulled a few degrees toward the accent hue, so a band separates without
   spending the accent's signal value. A candidate for the app if a page-header band is ever wanted.
3. **A 48px call-to-action size** (`SignInButton size="lg"`), against the app's 36px. At hero scale a 36px
   primary control reads as part of a form rather than as an invitation. Not to be carried into the app,
   where 36px is correct for a dense interface.

**Product shots are rendered in the DOM, not captured as images.** Every screenshot on the landing page is
HTML and CSS built from these tokens ([ProductShots.tsx](client/src/pages/landing/ProductShots.tsx)). This
was forced rather than chosen: a real capture of a roster would contain real student names, which is
indefensible for a product whose central claim is that it never holds student data. Since any shot must use
invented data regardless, rendering it in the DOM costs nothing and buys two things a PNG cannot have — it
follows the theme, and it cannot drift when a colour token moves. The trade is that the shots are a
*representation* of each tool, maintained separately from the real component, so they are close rather than
pixel-exact and need a look whenever a tool's layout changes materially.

**Container queries, not viewport queries, for the shots.** The roster row appears in the hero at nearly
full width and in the showcase panel at roughly two thirds of it, at the same viewport, so a viewport
breakpoint would always be wrong for one of them. Below 620px of *row* width it becomes three columns: name
over class and the indicator icons in a reserved fixed track, with only the email dropping. The flag track
is fixed rather than `auto`, because an `auto` track is sized per row and a student with no flag would let
the column slide. Worth borrowing for the real roster, which sits in a content area whose width depends on
the sidebar state. Both the shot and the real roster carried a further column of accommodation tags until
Step 8a; the shot must keep mirroring the roster, so they lost it together.

### The First-Run Guide (Phase 2 Step 5a)

`/welcome` is an app page, inside the app shell — not part of the public shell above, and not a modal or a
stepped tour over the interface. A tour has to be dismissed before the app can be used, arrives before the
teacher has any question it could answer, and is the thing people click past; a page can be read, skipped,
or returned to from **Getting started** in the account menu.

Its first draft was rejected in review for reading as a worse version of the marketing site, and the rules
that came out of that are the layout:

- **The action is the page, and it sits directly under the greeting.** One bordered `elevated` block with a
  `border-strong` edge — the only such block on the page, so it reads as the thing to do. Everything below
  it is reference.
- **Actions go where they claim to go.** The one "Add Students" button enters the real add grid via
  `?add=bulk` on the Students page rather than landing the teacher on an empty roster with the form to find.
- **Nothing here describes a tool.** Per-tool descriptions duplicated the landing page's showcase, taught
  nothing a click would not, and carried the same drift risk as a static screenshot. The sidebar strip is
  icons and names only, in `navConfig` order, so it maps the page onto the chrome without being able to go
  stale.
- **Prose is limited to what a click cannot teach**: where the data lives, and what happens when the trial
  ends. Two compact cards, not paragraphs.
- **The greeting takes `xl` (24px), the top of the app scale**, rather than the `lg` every tool header uses.
  It is a greeting rather than a page title, and at tool-header size it read as one more row of chrome. The
  display steps above `xl` stay reserved for the public pages — this renders inside the app shell.
- **A visible skip.** Onboarding that cannot be left is a wall.

---

## Color Palette

Both dark and light modes are supported from the start, toggled via a switch in the top bar. Light mode is the default. All colors are specified as hex values and will be mapped to Tailwind config tokens using `dark:` variants. The dark palette is defined first; the light palette follows.

### Backgrounds (darkest to lightest)

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `bg-base`          | `#1a1a1a` | Page background, behind everything                     |
| `bg-surface`       | `#1f1f1f` | Main content area                                      |
| `bg-sidebar`       | `#282828` | Sidebar background                                     |
| `bg-elevated`      | `#2d2d2d` | Cards, table rows, dropdowns, modals                   |
| `bg-hover`         | `#333333` | Hover state on interactive rows/cards                   |
| `bg-active`        | `#3a3a3a` | Active/pressed state                                   |

### Borders

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `border-subtle`    | `#3c3c3c` | Default border on cards, inputs, dividers              |
| `border-strong`    | `#505050` | Borders needing more contrast (focused inputs)         |

### Text

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `text-primary`     | `#e3e3e3` | Primary body text, headings                            |
| `text-secondary`   | `#9aa0a6` | Secondary labels, metadata, placeholders               |
| `text-disabled`    | `#5f6368` | Disabled controls, inactive states                     |

### Accent

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `accent-primary`   | `#ffab00` | Primary action buttons, active nav indicator, badges that need attention. Warm orange-gold, distinct from Google's cooler yellow. |
| `accent-hover`     | `#e69b00` | Hover state on accent elements                         |
| `accent-muted`     | `#ffab0020` | Accent used as a tinted background (e.g., badge bg), ~12% opacity over dark surface |

### Semantic

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `status-danger`    | `#d93025` | Delete actions, error messages, destructive confirmations |
| `status-danger-bg` | `#d9302515` | Background tint for error banners                      |
| `status-success`   | `#34a853` | Success confirmations, "sent" badges                   |
| `status-success-bg`| `#34a85315` | Background tint for success banners                    |
| `status-warning`   | `#fbbc04` | Threshold warnings. Cooler and less saturated than the accent to keep them distinguishable. |
| `status-info`      | `#4285f4` | Informational badges, help tooltips                    |

### Light Mode Palette

Light mode mirrors the same token names with inverted values. The accent and semantic colors remain the same in both modes.

**Backgrounds (lightest to darkest)**

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `bg-base`          | `#ffffff` | Page background                                       |
| `bg-surface`       | `#f8f9fa` | Main content area                                      |
| `bg-sidebar`       | `#f1f3f4` | Sidebar background                                     |
| `bg-elevated`      | `#ffffff` | Cards, table rows, dropdowns, modals (white with border) |
| `bg-hover`         | `#e8eaed` | Hover state on interactive rows/cards                   |
| `bg-active`        | `#dadce0` | Active/pressed state                                   |

**Borders (light mode)**

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `border-subtle`    | `#dadce0` | Default border on cards, inputs, dividers              |
| `border-strong`    | `#bdc1c6` | Borders needing more contrast (focused inputs)         |

**Text (light mode)**

| Token              | Hex       | Usage                                                  |
|--------------------|-----------|--------------------------------------------------------|
| `text-primary`     | `#202124` | Primary body text, headings                            |
| `text-secondary`   | `#5f6368` | Secondary labels, metadata, placeholders               |
| `text-disabled`    | `#9aa0a6` | Disabled controls, inactive states                     |

### Accent Color Usage Rules
- The accent color (`#ffab00`) is restricted to larger UI elements only: primary action buttons, badges, the active sidebar indicator, and attendance threshold alerts. It must never be used as text color on any background in either mode, because it fails WCAG AA contrast on both dark and light surfaces at body-text sizes.
- Non-primary buttons use `bg-elevated` with `text-primary`, not the accent color.
- Do not use the accent color for decorative purposes (borders, background fills, large areas). It loses its signal value when overused.

---

## Typography

### Font Stack
System font stack. No custom font loading overhead.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

### Scale

| Name     | Size   | Weight | Line Height | Usage                                      |
|----------|--------|--------|-------------|--------------------------------------------|
| `xs`     | 12px   | 400    | 16px        | Fine print, metadata, timestamps           |
| `sm`     | 13px   | 400    | 18px        | Table cells, secondary labels              |
| `base`   | 14px   | 400    | 20px        | Default body text, form inputs             |
| `md`     | 16px   | 500    | 24px        | Tool toolbar labels, section headers       |
| `lg`     | 20px   | 600    | 28px        | Page titles (tool name at top of content)  |
| `xl`     | 24px   | 600    | 32px        | Modal titles, large headings               |

### Conventions
- All-caps text is not used anywhere. It reduces readability and feels aggressive.
- Bold (`600`) is used for headings and interactive labels, not for emphasis within body text. If something needs emphasis, restructure the sentence or use the accent color.
- Monospace is not used in the teacher-facing UI. It may appear in admin/debug views only.

---

## Spacing

An 8px base grid. All padding, margins, gaps, and sizes are multiples of 4px (for fine adjustments) or 8px (for standard spacing).

| Token  | Value | Common Usage                                    |
|--------|-------|-------------------------------------------------|
| `xs`   | 4px   | Tight gaps (icon-to-label inside a button)      |
| `sm`   | 8px   | Compact padding (table cells, chip padding)     |
| `md`   | 16px  | Standard padding (card padding, input padding)  |
| `lg`   | 24px  | Section spacing, gaps between cards             |
| `xl`   | 32px  | Page-level padding, major section breaks        |
| `2xl`  | 48px  | Large separations (between major page sections) |

---

## Component Specifications

### Buttons

**Primary** (accent-colored, used once per visible context for the main action):
- Background: `accent-primary`
- Text: `#1a1a1a` (dark text on gold background for contrast)
- Border radius: 6px
- Padding: 8px 16px
- Height: 36px
- Hover: `accent-hover`
- No shadow. Shadows create visual clutter on dark backgrounds.

**Secondary** (most buttons):
- Background: `bg-elevated`
- Text: `text-primary`
- Border: 1px `border-subtle`
- Same dimensions as primary
- Hover: `bg-hover`

**Danger** (delete, discard):
- Same structure as secondary, but text color is `status-danger`
- On hover: background shifts to `status-danger-bg`

**Icon-only buttons** (toolbar actions, settings):
- 36x36px square, border-radius 50% (circular)
- No border
- Background transparent, `bg-hover` on hover
- Icon color: `text-secondary`, `text-primary` on hover

### Inputs

- Background: `bg-base`
- Border: 1px `border-subtle`, `border-strong` on focus
- Text: `text-primary`
- Placeholder: `text-secondary`
- Border radius: 6px
- Height: 36px
- Padding: 0 12px
- Focus ring: 2px accent-colored outline (not a box-shadow glow, just a clean outline)
- The light/dark mode toggle in the top bar is a small switch component, not a full-width input.

### Tables / Lists

The primary data display pattern. Used for the roster, attendance logs, email history.

- **Row height:** 48px minimum. Enough for comfortable click/tap targets.
- **Row background:** `bg-surface` default, `bg-hover` on hover.
- **Row borders:** 1px `border-subtle` bottom border only. No vertical dividers between columns.
- **Header row:** `text-secondary` text, `sm` size, uppercase NOT used. Sticky at the top of the scrollable area.
- **Selected row:** `accent-muted` background tint.
- **Zebra striping:** not used. Hover highlight is sufficient for tracking across wide rows. Alternating row colors add visual noise on dark backgrounds.

### Cards

Used for grouping results, name picker display, and content containers.

- Background: `bg-elevated`
- Border: 1px `border-subtle`
- Border radius: 8px
- Padding: 16px
- No shadow

### Modals

- Overlay: `#000000` at 50% opacity
- Modal background: `bg-elevated`
- Border radius: 12px
- Padding: 24px
- Max width: 560px (content modals), 400px (confirmation dialogs)
- **The 400px width is sized for two buttons.** A dialog whose footer carries three takes the content width
  instead: buttons are `whitespace-nowrap` and so cannot shrink, and three of them do not fit. The footer
  wraps rather than overflowing, which keeps a mistake here legible instead of pushing controls out through
  the side of the panel, but wrapping is the backstop and the width is the fix.
- Title in `lg` size at the top. Close button (X) top-right.
- Action buttons at the bottom-right, primary on the right, ordered least to most consequential from left to
  right. A destructive action is therefore rightmost — the delete dialog's `Cancel` / `Delete account` and
  the cancellation dialog's `Keep my subscription` / `Pause instead` / `Continue to cancel` follow the same
  rule.
- **The X is the only way to close a modal that has nothing to confirm.** A "Done" or "Close" button beside a
  real action reads as a confirmation of that action and gives the teacher two controls that differ only in
  where they are. A modal that acts on a selection therefore carries **at most one action button**, and
  mutually exclusive selections disable each other rather than producing a second one.
- **A list inside a modal that has no natural ceiling is bounded and scrolls within itself** (roughly five
  rows), rather than sizing the panel. The panel already scrolls as a whole against the viewport, but letting
  an unbounded list drive that height pushes the notices and the action button out of sight, and the teacher
  ends up scrolling the dialog to find the button. The archived class list was the case this rule was written
  for; it has since moved to the Manage Classes tab (see The Manage Classes Tab), where the page scrolls and no cap
  applies.

### Sidebar Navigation Items

- Height: 40px
- Padding: 0 16px
- Border radius: 8px (pill-shaped within the sidebar)
- Icon: 20x20px, `text-secondary` default
- Label: `base` size, `text-secondary` default
- **Active state:** `text-primary` for both label and icon, with a 3px left border in `accent-primary` or a subtle `accent-muted` background fill as the indicator. Choose one indicator, not both. (Accent color is used on the border/background element, not as text or icon color, per the accent contrast rule.)
- **Hover state (inactive):** `bg-hover` background

### Badges / Chips

Used for attendance status (present/absent/tardy), threshold alerts, email send counts.

- Border radius: 12px (pill)
- Padding: 2px 8px
- Font size: `xs`
- **Neutral:** `bg-hover` background, `text-secondary` text
- **Accent:** `accent-muted` background, `accent-primary` text (badges use larger/bolder text at `xs` size where the contrast is acceptable for UI components per WCAG AA 3:1 threshold)
- **Danger:** `status-danger-bg` background, `status-danger` text
- **Success:** `status-success-bg` background, `status-success` text

### Premium feature affordance

How a feature that is not on the free tier presents itself. The free-versus-paid split itself is
specified in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2 Step 3; this section covers only
how it looks.

> **Dormant, not deleted (Phase 2 Step 8a).** With `BILLING_ENABLED` off — the launch default — there is
> no boundary, so none of what follows renders: no star, no lock, no tooltip explanation, no notice, no
> upgrade prompt. Every component below is still in the tree and still tested, and this section is the
> specification it comes back to. **Do not implement a new gated control against it while the flag is
> off**; there is nothing to gate, and a control that locks against an entitlement every account has
> would be a lock a teacher cannot explain.

Premium features are **always visible, never hidden.** A teacher cannot want what they cannot see, and
surfacing the boundary continuously means nobody discovers it as an unpleasant surprise at the moment
they need the feature.

Three account states produce three presentations of the same control:

- **`paid`** — no marker of any kind. The control renders exactly as a normal control. A paying user
  should never see the word "premium" in the product.
- **`trial`** — the control is **fully usable**, and carries the **premium star**. This is the important
  case: it pre-teaches which features will be lost when the trial ends, so trial expiry is an expected
  transition rather than a betrayal.
- **`free`** — the control carries the **premium star** and is **disabled**: `text-disabled` text,
  reduced-opacity iconography, no hover state, `cursor-not-allowed`, and `aria-disabled="true"` with an
  `aria-describedby` pointing at the explanation so screen-reader users get the same information sighted
  users get from the tooltip. Clicking it does nothing destructive; where an upgrade path fits the layout,
  it opens the upgrade prompt.

**The premium marker is a star, not a word.** A filled accent `Star` (Lucide) at 14px, placed after the
control's label. Accent on an icon is an allowed non-text use of the accent colour; it is never rendered as
accent-coloured body text. No emoji, consistent with the project-wide rule.

This replaced a text badge reading `Premium` on every gated control. With markers on the attendance tabs,
two Display options buttons, Constraints, the threshold control, and the email quota chip, the repeated word
crowded each row and made the boundary feel like advertising rather than information. A star costs almost no
width and reads as an annotation.

**The star is explained once, in the sidebar footer**, next to the account's plan: a matching star followed
by "Paid plan feature" on `free`, or "Included until your trial ends" on `trial`. On `paid` neither the
markers nor the legend appear, since nothing is gated. This is the trade a legend makes — the marker itself
is silent, so the meaning has to live somewhere fixed and findable.

**A locked control says what unlocks it and nothing about billing** (Phase 2 Step 6i follow-up). The gated
surfaces present two states — premium or not — and never the reason premium is absent. The wording is the
same for a teacher whose trial ended, whose subscription ended, and whose billing is paused: *"Attendance
statistics are a premium feature."*

This is a deliberate narrowing. The lapsed variants were introduced in Step 6h for a good reason — someone
who has been reading Statistics for a month has had something taken away, and telling them the same thing as
a first-time visitor reads as a product that broke — but they put an account's payment history into a panel
about one student's attendance, and every new billing state added a new sentence to every locked surface.
The account page is where billing state belongs, and it is one click away.

`PremiumNotice` still carries the lapsed wording, including the assurance that records and the spreadsheet
are untouched. The student-detail attendance summary does not. If teachers ever report believing their
attendance records were deleted, that summary is the surface to revisit, because it is where the fear is
most plausible.

### Account state on the account page

The account's billing state is stated in one place, as badges under the email address on `/account`. Two
questions, answered in order: **what access this account has**, then **what is about to change about it**.

- The first is the **Premium mark** (the sidebar footer's accent-tinted pill, shared rather than
  re-styled) or a neutral "Free account" pill. A binary, because there is one paid plan and no third thing
  to be. A trial takes the Premium mark: `trial` and `paid` are entitlement-identical, so a trialling
  teacher does have Premium access.
- The second is a date, in a neutral pill — "Trial ends 13 September 2026", "Free promo pricing until
  17 August 2027". Neutral tokens deliberately: the accent belongs to the Premium mark, and two accent pills
  side by side read as decoration rather than information.

**A promo suppresses the trial date rather than appearing beside it.** Both are true and only the promo's is
operative — a promo-covered account rolls from `trial` to `paid` at trial end with no change in access and no
charge — so naming the trial date would announce a transition that does not happen, and it is the more
alarming-sounding of the two.

A paused account resolves to `free` and so reads "Free account", which alone would alarm someone who chose
the pause. The notice below the badges is what explains it, and is not optional.

**Every star keeps an explicit accessible name** (`Premium feature`), because a screen-reader user meets the
marker without the legend beside it. The star is icon-only to the eye, never to assistive technology. On a
disabled control the tooltip explanation below carries the rest.

**The explanation** appears in a standard tooltip on hover/focus of a disabled premium control, phrased
as what the feature does rather than as a sales line — for example "Keep-together and keep-apart rules
are part of the paid plan," not "Upgrade now to unlock." One sentence, no exclamation marks.

**A gated surface a free account reaches** — the Statistics tab, the student-detail statistics panel —
shows one fixed sentence: **"<Feature> is a paid plan feature."** (`paidPlanSentence`). Identical wording
everywhere, so the boundary reads as a property of the product rather than a different pitch each time it
is met. The feature is named and nothing more; anything longer starts arguing for the upgrade, which the
upgrade prompt is for.

**The upgrade prompt** is a content modal (`UpgradeModal`), dismissible with Escape and a Cancel button,
never blocking access to the rest of the app. It offers the two intervals as a radio pair with **annual
preselected and listed first**, lists what the paid plan adds, and states plainly that the teacher's data
stays in their own Google Sheet either way and that cancelling deletes nothing — the reassurance most
wanted at the moment of paying, and the product's whole positioning. "Continue to payment" hands off to
Stripe-hosted checkout; the card is never entered in this app.

**Where the upgrade prompt is offered, and where it is not.** There are three entry points, and they do
not all follow the same rule.

- **The account menu** and **the sidebar footer** offer it on `free` *and* `trial`. Both are places a
  teacher goes deliberately, so an upgrade offer there is an answer to a question they came to ask.
- **A gated control** offers it on `free` **only, never on `trial`.** On `trial` a premium control is live
  and merely badged, so attaching an upgrade prompt to it would interrupt someone who currently has access
  in order to sell them something they already have. On `free` the control is disabled, and upgrading is
  the one useful thing to do with it.
- The gated-control entry point is **built** (Phase 2 Step 5). It lives on `PremiumNotice`, the component
  that stands in for a premium view or panel on `free`, which is the only gated surface where an upgrade is
  the useful next action rather than an interruption: a disabled *control* already carries its explanation
  by tooltip, and adding a button to each one would repeat the offer across a page. The rule is read from
  `promptFromGatedControls` in `useUpgrade` rather than re-derived, so a notice on `trial` never renders one
  — and on `trial` the notice does not render at all, because the feature is live.
- It opens the existing upgrade modal rather than linking to `/pricing`. The public pricing page is framed
  for a signed-out visitor (it offers "Sign in with Google"), so sending a signed-in teacher there would
  hand them a page that asks them to do what they have already done. `PremiumNotice` reads the upgrade
  context optionally and renders no button when there is none, so a primitive never requires billing to be
  mounted in order to render.

**Terminology.** The paid tier is called **Premium** everywhere a teacher reads it — "Upgrade to
Premium", "X is a premium feature", "is part of Premium" — and the free tier is a **free account**, not a
"free plan". The words "paid plan" no longer appear in the interface. The underlying plan *values*
(`free` / `trial` / `paid`) are API and database vocabulary and are unchanged.

**The sidebar footer states the account, in three distinct treatments**, because the three plans want
different things said:

- **Premium** — a quiet pill marking the account state, **centred at every width**, and nothing else. No
  star legend (nothing visible is gated) and no offer (there is nothing left to sell). Collapsed to icons
  it becomes the sparkle alone in a rounded tile rather than disappearing.

  **It is state, not decoration, and the styling follows from that.** A paid teacher sees this element
  every day and can neither click it nor buy anything from it, so it is built to be recognised and then
  ignored. `accent-muted` fill, an `accent` border at 60% opacity, an `accent` sparkle, and a
  `text-primary` label at `sm` / `font-semibold` / normal tracking. The gold is carried by the tint,
  border, and icon; the words are ordinary text.

  **Definition comes from the border, not the fill.** A stronger tint (`#ffab0033`) was tried alongside
  the firmer border and reverted: the two together pushed the pill back toward reading as a filled
  control, and the border alone is what gives it a crisp edge. The tint stays at `accent-muted`, the
  same value the app's other accent chips use, so the mark gains its shape without gaining weight.

  **Rejected: a filled gold pill, and a gradient with a sheen.** Two problems, both structural rather
  than matters of taste. Every other accent *fill* in the app is a button, so a filled pill in the
  sidebar footer reads as pressable when nothing there is; and a glossy, high-chroma slab is
  call-to-action language applied to permanent furniture, which makes it compete with the navigation
  above it on every page load, forever. The gradient version also forced a foreground problem with no
  good answer: white on it was unreadable across the highlight, and dark text on a shiny gold slab is
  precisely the button styling being avoided.

  A consequence worth keeping: the mark now sits **inside** the accent rules rather than excepting
  itself from them. Accent is not a text colour here, it carries no light text, and the `xs` /
  `font-bold` / `tracking-wide` treatment an earlier draft used is gone — at 12px it read as a different
  typeface than the footer around it, and there is only one font in the app.
- **Free trial** — a bordered card with the plan name, **days remaining**, and a thin accent progress bar
  over the 30-day trial. The bar is `aria-hidden`; the figure beside it carries the same information to a
  screen reader. The countdown is the useful fact on a trial, and a bar reads as "running out" faster than
  a number does.
- **Free account** — the same card without the countdown: plan name, the star legend, and the upgrade
  button.

The card renders in the mobile drawer (always 220px, so it always has room) and in the desktop sidebar
once expanded. It is keyed off *which sidebar* rather than rendered twice and hidden with CSS, so only one
copy is ever in the DOM. Collapsed to icons the card is replaced by the tap-to-reveal star tooltip, and
the account menu carries the upgrade action at every width.

**"Manage billing" is shown by whether a Stripe customer exists, not by plan.** A lapsed account is `free`
but still has invoices, receipts, and a card worth managing, so the account menu can show both "Upgrade"
and "Manage billing" at once. It opens Stripe's hosted billing portal **in a new tab** — the portal is a separate errand, and returning should not mean reloading the app and losing whatever was open.

**Support lives in the account menu, not the sidebar.** The sidebar is the five tools, and a sixth item that
is not a tool would blur what that list means. "Help and support" therefore sits in the account menu on every
plan (support is not a premium feature and carries no star), and the operator-only "Support triage" entry
appears directly beneath it when the account is allowlisted, styled as an ordinary menu item with no accent
or badge so it is never mistaken for product UI — the same treatment the development plan toggle gets.

**The support page states the PII rule rather than assuming it.** The message field is the one place in the
app where a teacher could type student information into our database, so the form carries a plain line
asking them not to, next to the field rather than buried in a footer. Support request statuses (New, In
progress, Resolved, Closed) use neutral border and text tokens, never the accent: the accent means premium
throughout the app, and a support status has nothing to do with plan.

**Never gate legibility.** Controls that govern whether projected content can be read from the back of a
classroom (Grouping's Scale and fullscreen, the Name Picker's Size, fullscreen, and sound toggles, and
the app-wide light/dark theme) stay available on every plan and must never carry the premium star. Only
decoration is gated.

**The quota indicator is itself marked premium.** The Email tool's chip, which sits under the tabs on the
Compose tab only (sending is the only thing it measures), carries the star on `free` and
`trial`, because sending beyond the monthly allowance is the paid feature — this puts the number a teacher
is watching and the reason it is limited in the same place, rather than leaving them to discover the cap
only when a send is refused.

**Quotas always show the limit that binds.** The Email tool's quota indicator reads from the daily cap on
`trial` and `paid` ("153 remaining today") but from the monthly allowance on `free` ("18 of 30 remaining
this month"). Showing a free teacher "188 remaining today" would be true of the daily cap and useless as
guidance, since 30 a month is what will actually stop them. The same rule governs the over-cap warning on
the send button and the cap-reached message: both name the limit the account is actually up against. A
free account that has spent its month is told when the allowance resets, since it does, rather than being
shown a bare refusal.

### Tooltips

- Background: `#484848`
- Text: `text-primary`, `xs` size
- Border radius: 4px
- Padding: 4px 8px
- Appears after 500ms hover delay
- Positioned above the trigger element with a small arrow/caret
- **Stacking: above every sticky element on a page, below the mobile drawer overlay.** The bubble is
  the topmost thing on the page while it is open, and getting this wrong is not a cosmetic loss: the
  Attendance History grid and the Statistics table pin header cells above the page's ordinary
  content, and a tooltip below them explained a locked control from underneath a table. The
  explanation for a gated control is needed at exactly the moment it is hardest to see.

---

## Iconography

- **Style:** outlined, not filled. Consistent stroke width. Matches the lighter feel of dark-mode interfaces where filled icons look heavy.
- **Size:** 20x20px in the sidebar and toolbar, 16x16px inline with text.
- **Library:** Lucide React (open source, consistent outline style, tree-shakeable). Heroicons is an acceptable alternative.
- **Color:** inherits from text color of the parent element. Never independently colored except for the active sidebar item (accent).
- **Sidebar icon mappings** (Lucide names, subject to iteration):
  - Students: `Users`
  - Attendance: `CalendarCheck`
  - Grouping: `Group`
  - Name Picker: `Shuffle` or `Dices`
  - Email: `Mail`

---

## Interaction Patterns

### Loading States
- **Full page load:** centered spinner (simple rotating ring in `text-secondary`, not a branded animation).
- **Inline data fetch:** skeleton placeholders matching the shape of the expected content (rectangular blocks for text rows, circles for avatars). Skeleton color: `bg-hover` with a subtle pulse animation.
- **Button loading:** the button text is replaced with a small spinner. The button is disabled and does not change size.

### Empty States
- Centered in the content area.
- An icon (relevant to the tool, `text-disabled` color, 48x48px), a short heading, and a one-line description.
- A primary action button if applicable (e.g., "+ Add Students" on the empty roster).

### Toasts / Notifications

**Phase 1 status: not built. Confirmations are inline, and that is accepted for Phase 1.** Feedback is
shown as an inline banner or status line within the acting view (e.g. the green "sent" confirmation in the
Email composer, the bulk-add result summary, per-field validation errors). This keeps feedback next to the
control that produced it, at the cost of the fixed bottom-right location the toast spec below describes.

**Phase 3 consideration — an inline/toast hybrid.** Keep inline banners for *contextual* feedback that
should point at a specific control (validation errors, a failed row), and add corner toasts only for
*transient success* confirmations that are not tied to a location on screen ("Template saved", "Attendance
saved"). Revisit then; the toast spec below is the target shape if toasts are built.

The toast specification (target if built):
- Appear in the bottom-right corner, above the content, below the top bar.
- Auto-dismiss after 5 seconds. Manually dismissable via an X button.
- Same card styling as elevated surfaces. Left border colored by severity (accent, danger, success, info).
- Stack vertically if multiple are active.

### Hub pages (Phase 2 Step 6f)

A page whose whole content is a short list of destinations, used by Account settings and Help and support.
Both are reached from the account menu, and they share one `ActionList` component rather than each building
their own — the menu got out of hand precisely by growing an item at a time, and the fix only holds if the
places those items moved to keep looking like each other.

- **A row is a bordered card** on `bg-elevated`: a leading 18px icon, a `text-sm` semibold label, a
  `text-sm` secondary line saying what it does, and a trailing chevron. Rows stack with `gap-3`, and the page
  is capped at `max-w-2xl` so the description line stays readable.
- **The description is not decoration.** These are consequential destinations rather than buttons in a form,
  and the difference between "Log out of all sessions" and "Delete account" is something a teacher should be
  able to read before clicking rather than after.
- **A row is a link or a button, never both.** A destination renders as an anchor so middle-click and
  open-in-new-tab work; an action that changes something renders as a button so it does not.
- **A destructive row is tinted, not restyled.** `text-danger` on the icon and label; the card, spacing and
  chevron are identical to every other row. The page is a list of things you can do, and one of them is
  serious — it is not a danger zone.
- **Rows group under a heading when they answer different questions.** The Help hub puts the contact form
  alone at the top and everything there is to read (the data documentation, FAQ, privacy policy, terms) under
  a "Reference" heading below. The split is not by importance but by whether a row *starts* something: the
  contact row creates a support request, and it should not sit in a list of documents where it can be clicked
  by momentum.

### Confirmations
- Destructive actions (delete student, discard email draft, remove grouping) always require a confirmation modal.
- The confirmation modal states what will happen in plain terms ("This will remove Alex from the roster along with their attendance records").
- The destructive action button is labeled with the specific verb ("Delete Student"), not a generic "Confirm" or "OK".
- **An irreversible, account-level action additionally requires the word "Delete" to be typed** (Step 6f;
  account deletion is the only one so far). The field sits below the consequences rather than beside the
  button, so the list has to be read past on the way to it, and the confirm button stays disabled until it
  matches. The match is trimmed and case-insensitive: the point is deliberateness, and someone who typed the
  word was deliberate — refusing "delete" for its lowercase d only teaches them to resent the control.
- **Focus on open is a mount-only concern.** `Modal` focuses its panel once, from an effect with no
  dependencies. It used to share the effect that registers the Escape listener, which is keyed on `onClose`,
  so any caller passing an inline handler *and* holding a text field's state in the same component pulled
  focus back to the panel on every keystroke and could type exactly one character. Do not fold the focus call
  back in.

### Remembered selections

- **A tool's class selection survives navigating away and back**, for the whole time the app is open; a fresh
  app session starts at the default (the first class alphabetically). This applies to the roster's filters and
  sorts, and to the single-class scope of Attendance, Grouping and the Name Picker. A teacher works in one
  class at a time and moves between tools within it, so resetting the scope on every remount put them in a
  class they were not teaching — and in Attendance that means recording against the wrong one.
- **Remembered per tool, not shared between them.** One selection across all four would mean changing the
  class in the Name Picker also changes which class attendance is about to be taken for.
- **In memory, not localStorage.** Persisting to disk raises what to do with a stored class that no longer
  exists a term later; the within-session case is the one that was actually costing anything. The Name
  Picker's display preferences are the deliberate exception — they are settings rather than a position in a
  task.
- A remembered class that no longer exists (archived, or its last student removed) falls back to the default
  rather than showing an empty view.
- **The Email tool is excluded**: it selects recipients across classes rather than scoping to one.

### Transitions
- Sidebar collapse/expand: 200ms ease-out
- Modal open/close: 150ms fade + slight scale
- Hover background changes: 100ms ease
- Page/tool transitions: no animation. Instant swap. Animated page transitions add latency perception without value in a productivity tool.

---

## Responsive Breakpoints

| Breakpoint | Width    | Layout Changes                                           |
|------------|----------|----------------------------------------------------------|
| Desktop    | ≥1280px  | Full layout. Sidebar expanded. Content max-width 1200px. |
| Laptop     | ≥1024px  | Full layout. Content fills available width.               |
| Tablet     | ≥768px   | Sidebar collapses to icon-only (64px).                   |
| Mobile     | <768px   | Sidebar becomes a slide-out drawer. Tool toolbar wraps or moves into a dropdown menu. Tables switch to card-based layouts. |

### Mobile Considerations
Teachneat is primarily a desktop/laptop tool (used at a desk, often on a school-issued laptop or personal computer). Mobile is a secondary concern but should not be broken. The name picker and attendance entry are the most likely mobile use cases (teacher walking around the classroom).

---

## Accessibility

- **Contrast ratios:** all text/background combinations must meet WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text and UI components). The dark palette above should be validated against this.
- **Focus indicators:** all interactive elements show a visible focus ring when navigated via keyboard. The accent-colored outline on inputs extends to buttons, links, and nav items.
- **ARIA labels:** icon-only buttons must have `aria-label` attributes. The sidebar nav uses `role="navigation"` and `aria-current="page"` on the active item.
- **Reduced motion:** users with `prefers-reduced-motion` skip all transitions and animations (name picker animations still function but skip to the result).
- **Screen reader announcements:** toast notifications use `role="status"` and `aria-live="polite"`. Modal open/close manages focus trapping.

---

## Students Page

The Students page has two tabs (see Page tabs), **Roster** at `/students/roster` and **Manage Classes** at `/students/classes`, plus a **student detail view** at `/students/:studentId`. The app's landing path `/` redirects to `/students`, which lands on the tab last used. The transition between roster and detail follows the Gmail pattern: clicking a row opens the detail view, and a back button returns to the roster. The page header holds the title and, on the Roster tab only, the class filter; Manage Classes lists every class, so a class filter there would have nothing to act on.

### Roster List View

The default view. Displays all students as rows in a table/list, similar to files in Google Drive or emails in Gmail.

**Columns displayed per row:**
- Student name (first + last, with "goes by" in parentheses if set)
- Course(s)/class(es) — a student may be enrolled in more than one; these are shown comma-separated
- Student email
- Warning indicators: the academic-risk triangle and the high-absence icon, in a reserved fixed track so
  they line up down the list. A student with neither leaves the track empty rather than letting the
  columns after it slide. The roster carried a further column of IEP accommodation tags until Phase 2
  Step 8a removed that surface permanently.

**Toolbar (list view)**, under the tabs, left to right: **Sort**, **Alerts**, and **Add Students** at the right end.
- The class filter (matches any student enrolled in that course) is in the page header above the tabs, where Attendance, Grouping and the Name Picker keep theirs. The alerts filter (academic risk / high absences) is scoped by the class filter when one is set. An accommodation filter sat here until Step 8a.
- Sort options: by last name (default), by first name, by course (a multi-course student sorts by their first course alphabetically). The course sort option is hidden while a specific course filter is active (sorting by course is meaningless within one course).
- The filter and sort selections persist while the app is open (navigating to a student and back keeps them); a fresh app session starts at the defaults.
- Primary action button: "+ Add Students", the only add action. It opens the full-width entry grid titled "Add Students", which serves one student as well as a class list; a student is enrolled in several classes through a comma-separated course cell. A separate single-student add form and a "Bulk Add" button existed until testing feedback consolidated them on 2026-09-13, because two buttons for the same task made the teacher choose between them for no benefit. The student modal with its class chip list remains, for editing only.

**Behavior:**
- Rows are clickable. Clicking anywhere on a row navigates to the student detail view for that student.
- Hover state follows the standard row hover (`bg-hover`).
- The Roster tab is the default landing page for the entire app.

### Student Detail View

Opened by clicking a student row. Replaces the list view in the main content area (not a modal or side panel).

**Back navigation:**
- A back button/arrow at the top-left of the content area returns to the roster list view. Follows the same pattern as Gmail's back arrow when viewing an email.
- The sidebar remains visible and unchanged. The "Students" nav item stays active.

**Content sections (top to bottom):**
- **Header area:** student name (large, `lg` text), pronouns, "goes by" name, and the student's course/class enrollments (comma-separated).
- **Contact info:** student email, parent/guardian email(s). Multiple parent emails are displayed individually. The API returns them as a JSON array; the underlying sheet stores them pipe-delimited per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md), but the UI never sees the raw string. Edit-in-place or an edit button to modify.
- **Notes:** a free-text area for general notes about the student that don't fit into the structured fields above.
- **Attendance panel:** one card titled "Attendance", holding two labelled sections — **History** (the heatmap) and **Statistics** (the summary tiles), in that order. History comes first because it is the record of what happened and the totals are read off it. The two sit **side by side from `xl` up** and stack below it, where a column would squeeze the heatmap into too few weeks to be worth showing; the heatmap takes the wider share (3fr to the summary's 2fr) and adapts its week count to the space it gets. This is read-only here; detailed attendance management happens in the Attendance tool. Because attendance is per class, a student enrolled in more than one course gets a **class dropdown** in the card header that scopes both sections; single-course students show no dropdown.
- **Statistics is premium, History is not** (Phase 2 Step 3). The Statistics subheading carries the premium star. On `free` the section renders the same tiles, **blurred and valueless** (labels intact, every figure an em dash), with a one-line explanation over them — the shape of what the paid plan adds stays visible while the figures do not, which a blank panel would not convey. The blurred tiles are `aria-hidden`; the explanation is real text. The gated endpoint is not called on `free`, so nothing is fetched to be hidden. Each section states its own empty case, in its own words, since the two sit side by side and would otherwise print the same sentence twice.
- **Attendance heatmap:** the History section's grid, GitHub-contribution style: columns are weeks and rows are the five school days (Mon–Fri; weekends are omitted). Color assignments: a present day is blue (`info`), tardy is `warning`, absent is `danger`, an excused day is a dark gray (`secondary`), and a day with no recorded attendance is a faint fill (`hover`). Cells scale slightly on hover and a readout line below the grid names the hovered day and status (replacing a native tooltip). The widget is horizontally centered within the card; when the history is long enough to overflow it scrolls, opening on the most recent week. It reads the shared attendance range endpoint and filters to this student (and the selected class, when one is chosen) client-side.

**Toolbar (detail view):**
- Back button (left side)
- Edit / Save button (right side)
- Delete Student button (right side, danger style, triggers confirmation modal)

### The Manage Classes Tab

`/students/classes` (the old `/classes` redirects there). It replaced the archive dialog on 2026-09-13, first as
a page of its own and then as the second Students tab. A dialog capped its lists at five rows and could not
grow into class management. Being a tab also keeps it reachable from an empty roster, which is what archiving
every class at the end of a term leaves behind.

**Layout, top to bottom, under the tabs:**
- No explanatory text. What the teacher needs is said at the moment it applies, in the selection bar.
- **The selection bar**, a bordered `bg-elevated` bar sticky under the top bar. It is the only place the
  page's primary action lives and the only place a move reports on itself, so the teacher's eye stays in one
  spot through select, act and result:
  - nothing selected: "Select classes to archive or restore them." in secondary text, no buttons;
  - something selected: "3 classes selected", then **Clear** (secondary) and **Archive 3 classes** or
    **Restore 1 class** (primary). When archiving, it adds that students who are also in a current class stay
    on the roster, which is the question a teacher has at exactly that moment and at no other;
  - running: "Archiving your classes. This takes a few seconds." with the primary button showing its spinner;
  - done: "Archived 3 classes." with **Undo** (secondary), or "Restored 1 class." Changing the selection
    clears it.
- A failure shows in the standard danger banner below the bar. A move that had to rename a class (a restore
  into a current class's name, or an archive into an archived class's name) shows a warning banner saying
  which, naming both names and pointing at the pencil button. Renaming that class removes its notice.
- Two lists, **side by side from `lg`** and stacked below: **Current classes** and **Archived classes**. Each
  is a bordered list following the Tables / Lists spec: a `bg-elevated` header row carrying a select-all
  checkbox (indeterminate when part of the list is selected), the list name and its count, then 48px rows on
  `bg-surface` with `bg-hover` on hover and the `accent-muted` tint when selected. Neither list is
  height-capped; the page scrolls.
- A row is a checkbox, the class name, a secondary line and a trailing pencil icon button. A current class's
  secondary line is its student count only: its name is unique, and the one date it could show is when the
  app first saw the class, which reads as a start date and is not. An archived class's line adds both dates,
  because an archived class may share its name with a current one (reusing a name each year is the normal
  case) and the dates say which term it was. Two archived classes never share a name: archiving into a name
  the archive already holds appends the creation year, as restoring does.
- The archived list is ordered most recently archived first, with no year subheadings. Every archived row
  already carries its dates, so a heading per year repeated them; headings were tried and removed on
  2026-09-13.
- Empty lists say what fills them: "No current classes. A class appears here once it has students." and
  "Classes you archive appear here."

**One direction at a time.** Selecting in one list disables the other list's checkboxes, including its
select-all. Since the bar holds a single action button, there is never a second primary button on screen for
the opposite write.

**Rename** is the pencil button at the end of every row, live and archived (`aria-label` "Rename <class>").
It turns the row into a name field with Cancel and Save, in the modal button order; Enter saves and Escape
cancels. A taken name is shown as an error under the field and the edit stays open. Only one row is editable
at a time, and renaming stays available while a list's selection is locked, since it is not part of that
selection.

**The Roster tab reflects every change at once.** Both tabs are one mounted page, so an archive, restore or
rename reloads the roster rather than leaving it as it was before the change. Renaming the class the roster is
filtered to moves the filter to the new name.

**Leaving mid-operation.** While an archive, restore or rename runs, closing or reloading the tab raises the
browser's leave prompt. Navigating elsewhere in the app is not blocked: the server completes the operation
regardless, so what leaving costs is the result notice, not the data.

---

## Attendance Tool

The Attendance page has three views, reached by a row of tabs under the page header (see Page tabs below), in this order: **Daily Entry**, **History**, and **Statistics**. The order runs from raw to aggregate — one day in detail, then every day as recorded, then the totals derived from them. The free/paid line falls between the second and the third: Daily Entry and History are free, because both are the record of what was taken, and only **Statistics** is premium (Phase 2 Step 3), because it is the only one that computes anything. The same line runs through the student detail view (see Students Page). A single course dropdown scopes all three views to one class at a time; it defaults to the first course alphabetically. Attendance is taken per class, so there is no "all classes" option — a class is always selected. A student enrolled in more than one course appears under each of their classes and holds an independent status per class per day.

### Page tabs

A page's sub-pages are a row of underlined tabs directly under its header (`TabNav`), not a segmented control
inside the header or a nested sidebar item. Adopted on 2026-09-13 for Attendance (Daily Entry / History /
Statistics), then Students (Roster / Manage Classes) and Email (Compose / Templates), after trying it on
Attendance first against nesting sub-pages in the sidebar, which the tablet icon rail could not show.

- **Navigation and controls are separated by position.** The header row holds the title and the page's
  controls (the class picker); the tab row holds only navigation. A control that belongs to one tab alone
  sits under the tabs inside that tab, not in the header: Email's sending allowance shows on Compose only. A segmented control among other controls
  made "which view am I in" look like one more setting. Google Classroom uses the same arrangement for Stream,
  Classwork and People, so it is familiar to most of this app's users.
- **Each tab is its own route** (`/attendance/daily`, `/attendance/history`, `/attendance/statistics`),
  rendered as a link with `aria-current="page"` when active, so the address, the back button and
  open-in-new-tab all work. The page's bare path redirects to the tab last used, and an unknown slug does the
  same.
- **The last tab is remembered per page** while the app is open, in memory like the class selections (see
  Remembered selections); a fresh session starts on the first tab.
- **Styling:** `text-sm` semibold labels, `text-secondary` with `text-primary` on hover and when active,
  40px tall and 16px apart. Every tab sits on its own 3px rounded bar: accent under the active tab (the
  sidebar's active indicator turned on its side), `subtle` grey under the others, darkening to `strong` on
  hover. **There is no full-width rule under the row.** One was tried first, and together with the top border
  of the list that usually follows each page's toolbar, it boxed the controls between two page-width lines
  that read as an empty table row. The row wraps on a screen too narrow for it rather than scrolling: a scrolling row clips, and a disabled
  tab's tooltip opens below the tab, so a scrolling row hid it. Every page's tabs fit one line at 375px.
- **Page headers hold a constant height** (`min-h-9`, the height of the controls they usually carry), so a
  header with no controls, like Email's, or one that drops its class filter on a tab, does not move the title
  and tabs up by 8px. The document also reserves the scrollbar's width (`scrollbar-gutter: stable`), since the
  content column is centred and a page tall enough to scroll would otherwise sit a few pixels left of one that
  is not.
- **A gated tab** renders as focusable, non-link text in `text-disabled` with `aria-disabled`, its premium
  star, and the same hover explanation and screen-reader description a gated button carries. The explanation
  is anchored to the tab's right edge when the tab sits far enough right that a centred bubble would pass
  the edge of a phone screen (Statistics does). Opening its
  address directly shows the premium notice in place of the view.

### Daily Entry

- A date picker selects the day (defaulting to today; future dates are not selectable). Each in-scope student is a row showing name and course, a four-way status control (Present / Absent / Tardy / Excused) using the compact single-letter selectors, and an optional per-row note field.
- Every student defaults to Present. A "Mark All Present" action resets the visible rows. "Save Attendance" submits one entry per in-scope student and overwrites that date's records for those students in the selected class only — records in the student's other classes, and for students absent from the submission, are untouched.
- Selecting a past date loads that day's recorded statuses and notes for review or correction.
- **Weekends:** when the selected date is a Saturday or Sunday, all rows render grayed-out and read-only with the status fixed at Excused, and saving is disabled. Weekends are non-instructional and carry no attendance.
- A student's name links to that student's detail view on the Students page.

### History

A read-only grid of the selected class's recorded attendance: one row per student, one column per school day, scrolling horizontally into the past. It reads as Daily Entry with the status buttons replaced by a strip of colored day cells.

- **Rows** are the in-scope students sorted by last name, matching Daily Entry's order, with a very faint zebra stripe (alternate rows one background step lighter) to help the eye track across a wide row. The student-name column is **sticky to the left edge** so names stay anchored while the days scroll under them, and the name links to that student's detail view, matching the other two views. The name column is the only interactive element in the grid.
- **Columns** are school days (Mon–Fri) within the window. Weekends get no column of their own; instead a small fixed gap separates one week from the next — an 8px transparent left border on each week's first day, which takes the row's own background so it reads as blank space and keeps every column aligned — so week breaks stay readable without spending roughly a fifth of the scroll width on days that can never hold data.
- **Window:** a trailing 26 weeks (the same constant as the student-detail heatmap, roughly a semester), opening scrolled fully right on the most recent day. Leading weeks in which no student in the class has a record are trimmed, with a minimum window kept, matching the heatmap. There are no date controls; the teacher scrolls.
- **Scrolling and sticky headers.** The grid sits in a bounded, vertically-scrollable container so a long roster scrolls within the view rather than pushing the page. Both header rows — the month band and the day-number row — stick to the top while scrolling down, and the name column stays stuck to the left while scrolling sideways, so a cell's date and student remain identifiable however far the teacher has scrolled.
- **Cell colors** are the heatmap's, from the shared classifier, so the two views cannot disagree: present is blue (`info`), tardy is `warning`, absent is `danger`, excused is a dark gray (`secondary`), and a school day with no record is a faint fill (`hover`). Days later than today render as empty space.
- A record carrying a note gets a **small corner dot**; the note text itself appears in the hover readout rather than on the cell, which has no room for it.
- **Hover** cross-highlights the cell's row and column with two faint translucent bars whose overlap marks the exact cell — the affordance that makes a grid this wide scannable — and a **single readout line below the grid** names the hovered cell: student, full date, status, and note when there is one. This replaces native tooltips, matching the heatmap's readout pattern. The highlight is drawn as two positioned overlay bars rather than per-cell styling, so moving the pointer never re-renders the grid.
- The **legend** below the grid is the heatmap's, unchanged.
- **Loading** renders a skeleton shaped like the table — a blank header bar at about the header's height, then a single student row showing just the name-column gutter — rather than a spinner, per the shared skeleton convention. A class with no records anywhere in the window shows the empty state, not a grid of faint cells.
- **Accessibility:** unlike the heatmap, this grid is not a `role="img"`. The heatmap can be one because a textual attendance summary sits beside it carrying the same information; History *is* the data, with no textual equivalent on the page, so it must be navigable by assistive tech. It renders as a real `<table>` with `<th scope="row">` student names and `<th scope="col">` dates, and each cell carries visually hidden status text. Color is never the only channel: the readout and the hidden cell text both name the status in words.

### Statistics

- A per-student table: days recorded, absences, tardies, excused, absence rate, and current consecutive-absence streak. An optional date range (both bounds, start before end) scopes the figures; cleared, it covers all recorded data.
- Students over the high-absence threshold carry a "High absences" badge. The default is an **absence rate over 15% across at least 5 recorded days** (`HIGH_ABSENCE_RISK` in the attendance service, mirrored client-side). This corrects an earlier version of this line, which described a 10%-or-5-absences rule that was never what shipped.
- **The threshold is stated wherever the flag appears, never left implicit.** A teacher cannot judge a warning whose rule they cannot see. The roster's high-absence tooltip, the Statistics badge, and the student-detail summary all name it in words — "High absences (over 15% of recorded days): Math 10" — using the effective threshold for the account rather than a hardcoded number. Only the **rate** is named; the fixed sample floor is left to the settings modal, since repeating it in every label made the rule read as two numbers when the teacher only ever sets one.
- **Changing the threshold is a premium control** (Phase 2 Step 3), placed in the Statistics view toolbar, which is itself premium — so a `free` account reads the default in tooltips and never meets a disabled control it could not reach anyway. It follows the Premium feature affordance rules on `trial`. A **single** percentage input, saved via `PUT /settings`, applying to every class rather than per class. The minimum-recorded-days floor is fixed at 5 and is not exposed: it is a statistical guard against flagging a class with almost no data, not a policy choice, and a second input made a one-number rule read as a two-number one. The modal states the floor in prose so the rule is still fully visible. The toolbar states the current rule in words beside the control, so the number is visible before the modal is opened. An account that has lapsed to `free` but has a saved threshold is told, in a line under the control, what upgrading would restore — its setting is retained, not reset.
- **The threshold sits in its own right-aligned column** of the Statistics toolbar, opposite the date-range controls, with the warning `CalendarX` in `status-warning` beside it. The range is what the teacher scopes; the threshold is what the flag means. Reading them as one line conflated the two.
- A student's name links to that student's detail view, matching the entry view.

---

## Grouping Tool

The Grouping page is dual-purpose: a teacher-facing configuration surface **and** a class-facing display
meant to be projected so students can see which group they are in and who they are with. Its layout is
built around being readable from across a room while projected.

### Layout

- **Toolbar row:** page title and a class dropdown (same course-scoping pattern as Attendance; defaults
  to the first course alphabetically).
- **Config panel:** a `bg-elevated` card holding the levers — a segmented toggle for the grouping mode
  (Group size vs Number of groups), a numeric input for the target, a primary **Generate / Regenerate**
  button, and secondary **Constraints** and **Display options** buttons (both open modals). Fullscreen on
  the canvas gives the clean projection view, so there is no separate hide-controls toggle.
- **Results canvas:** a `bg-surface` card that holds a small display toolbar plus the group cards. The
  toolbar lives inside the canvas element so it stays reachable in fullscreen.

### Generation and per-class persistence (auto-save)

Group generation runs **client-side** so **Regenerate is instant and can be mashed** — pressing it
reshuffles the arrangement on screen immediately with no network round-trip. Each class keeps exactly
**one** grouping, and every change (generate, drag a student between groups, renumber) is **auto-saved
with a short debounce**: a burst of presses collapses into a single write once the teacher stops, rather
than a save per press. Switching class or leaving the page flushes any pending write first. Opening the
page or switching class restores that class's saved grouping. There is no explicit Save button and no
multi-grouping history.

### Group cards

Groups render as arranged cards on the canvas — a centered `flex-wrap` that reads like clusters of desks
in a room rather than a list.

- Card: `bg-elevated`, `border-subtle`, rounded. Header bar is a saturated colour fill (gold accent by
  default, or a colour chosen in Display options) with a contrasting foreground — an allowed large-element
  colour use, never as body text — labeled **Group 1**, **Group 2**, … No member count is shown.
- Member names are listed large and legible, one per line, using the preferred/first name plus a last
  initial (`goesBy` when set, otherwise `firstName`). Line-height is unitless so it scales with the size
  control and names never overlap at large sizes.
- **Drag to move:** a student name can be dragged from its card onto another group's card to move them; a
  group emptied by a move disappears. (Mouse drag-and-drop; keyboard users reorder via the header
  controls below.)
- **Renumber:** each card header carries ◀ / ▶ controls that swap the group with its neighbour, changing
  the group numbering.

### Projection controls

- **Scale:** a −/＋ pair drives a single font-size on the canvas; all card metrics (padding, gaps,
  line-height) are expressed in `em`/unitless, so one value scales the whole layout. Range is clamped but
  generous, for large rooms.
- **Fullscreen:** a button calls the Fullscreen API on the canvas container (icon and `aria-label` toggle
  between enter/exit); Esc exits. In fullscreen the groups centre vertically rather than top-aligning.

Icon-only controls (scale, fullscreen, renumber) carry `aria-label`s. Both light and dark modes use the
standard tokens.

### Constraints and display options

Both buttons are **premium** (premium star, disabled on `free`, usable-with-star on `trial`) per the
Premium feature affordance section. Random generation itself, and the Scale and fullscreen projection
controls, stay free.

- **Constraints** open in a content modal: a form to add a *Keep together* / *Keep apart* rule over 2–10
  students chosen from the in-scope class, plus a list of saved constraints with per-row removal.
  Unsatisfiable combinations (a pair required both together and apart, or apart rules that can't fit the
  requested number of groups) surface as an inline error when generating.
- **Display options** open in a content modal controlling the projected look (a global preference stored
  in localStorage): a **font** choice (system fonts only), a **group header colour** swatch — including a
  **Rainbow** option where each group's header takes the next colour from a cycling palette (its swatch is
  a four-colour band preview) — and a
  **Mark group leader** toggle that stars the first member of each group.

## Name Picker Tool

The Name Picker draws one student at random from the roster, with an animated reveal meant to be shown to
the class. Like Grouping it is class-scoped and reads well when projected. It is entirely client-side —
selection runs in the browser over the roster already loaded; there is no server round-trip per pick.

### Layout

- **Toolbar row:** page title and a class dropdown (same course-scoping pattern as Attendance and
  Grouping; defaults to the first course alphabetically).
- **Config panel:** a `bg-elevated` card of two rows. The first has the segmented **Style** toggle (Card deck
  vs Wheel) on the left and, pushed right, the round's **Picked _n_ of _m_** count (when removal is on), a
  **Reset** button (likewise), and the primary **Pick a name** button. The second has the **Display options**
  button (opens a modal, like Grouping's) on the left and, pushed right beneath the action buttons, the
  **Remove selected students** switch. The switch sits there rather than beside **Style** because it is about
  those buttons: it decides whether a pick removes that student from the pool, which is what makes Reset and
  the count appear at all. Next to Style it read as a third display option, which is the one thing it is not.
  All picker preferences are stored in localStorage.
- **Stage:** a `bg-surface` card (the same projection surface pattern as the Grouping canvas) with a
  **Size** control (−/＋, larger by default so it reads across a room), a **sound on/off** toggle beside it,
  and a **fullscreen** toggle; it hosts the animation and, below it, a "Selected" caption naming the chosen
  student once the animation settles. The animation scales with the Size knob.
- **Display options modal:** a **Font** choice (system fonts only) that edits the **current mode's** font —
  wheel and card deck keep their own — plus, for the current mode, **Wheel colours** (a Rainbow default
  whose swatch is the same four-band icon Grouping uses, plus two-tone alternating schemes: Black & white
  and several complementary pairs) or **Card back** designs (mini card previews of each backing). The
  **Display options** button is **premium** (premium star, disabled on `free`) — every option inside it is
  decorative. The Size, fullscreen, and sound controls on the stage are free, since they govern whether the
  reveal is readable and audible across a room.

### Selection

Each pick is uniform over the eligible pool. **The picker does not draw on its own — nothing animates
until a draw is triggered.** A draw is triggered by the **Pick a name** button or by **clicking the
animation itself** — the wheel or the card deck (all no-op while an animation is in progress). With
**Remove selected students** on, a drawn
student is removed from the pool **on the next draw**, so the current selection stays visible (on the wheel
and as the caption) until then; when the pool empties, the stage shows an "Everyone has been picked" state
with a reset action. **Reset** clears the round (the removal history) but **keeps the last "Selected"
caption** on screen. Switching class starts a fresh round. Small rosters (1–2) and large rosters (40+) both
work: a one-name pool resolves immediately, and the wheel renders one segment per student however many
there are.

### Animation modes

- **Card deck:** a real 5:7 playing-card stack. On a draw, any face-up card first **flips face-down**
  (its name stays readable until it rotates out of view), *then* the deck **shuffles** (two depth cards
  riffle apart and back), *then* the top card **flips face-up** to reveal the new winner — the shuffle
  waits for the flip-down to finish. The **card back** is chosen in Display options (Classic gold-bordered
  weave by default, plus Crimson / Forest / Royal / Dots); the face uses the standard surface tokens with
  container-query-sized text.
- **Wheel:** a colour-segmented wheel, one segment per eligible student, spun by a CSS-transition rotation
  that lands the winner under a fixed **black pointer with a thin light outline on the right (3 o'clock)**.
  Labels run **radially, like spokes**, all with the **same orientation** (no per-segment flipping), chosen
  so a name reads **right-side-up exactly as its segment passes the pointer**; they start well out from the
  hub and run outward, truncating at whatever length the remaining radius allows so a name never overruns
  the rim. The label font uses a **low ceiling with a gentle slope** — modest for a near-empty wheel, only
  a little smaller as it fills — so few big names don't overflow and many names stay legible. The wheel
  carries the same soft **drop shadow** as the cards. A spin lands the pointer **anywhere across the
  winning segment**, not always dead-center (a small buffer keeps it clear of the borders so the result is
  never ambiguous) — so it occasionally stops near a border for a playful "close call". The **colour
  scheme** is chosen in Display options
  (Rainbow default, or a two-tone alternating pair); labels use each segment's contrasting foreground. The
  spin is deliberately **low-friction** — a long, gentle coast (~6s) that starts at a moderate pace rather
  than whipping around and braking hard.
- **Sound:** both modes play synthesized effects by default (decelerating ticks + a landing chime for the
  wheel; riffle + flip whooshes for the deck), toggleable off via the stage's sound icon. Skipped under
  reduced motion and honoured per the sound preference.
- **Marble race** is a deferred stretch mode (not built). If built, the Style toggle's Marble race option
  is itself **premium** — the whole mode, not just its display options — and on `free` renders as a
  disabled segment with the premium star.

Winner selection happens before the animation; the animation only reveals the pre-decided result, so
fairness does not depend on the visuals. Under `prefers-reduced-motion` both modes skip straight to the
result (the JS timers are bypassed, not just the CSS transitions). Icon-bearing controls carry text
labels; both light and dark modes use the standard tokens.

## Decisions and Open Questions

Settled design decisions live under Decisions Made in [HISTORY.md](HISTORY.md), alongside the rest of the
project's decision record; open design questions are in [NEXT_STEPS.md](NEXT_STEPS.md). This document
remains the authoritative spec for the visual language and component behavior itself.
