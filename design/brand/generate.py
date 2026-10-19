"""
Generates the Teachneat brand assets from one definition of the geometry.

Everything in this folder is output. Nothing here is edited by hand — change
the constants below and re-run:

    py design/brand/generate.py

The mark is pure geometry (three rounded rectangles, two of them tipped about
the point they stand on), so it rasterizes exactly and the SVG and the PNGs
cannot drift apart. The wordmark is type set in the system font stack, which is
the opposite situation: it has no fixed outline, and the SVG emitted for it is a
convenience for contexts that need a file rather than the canonical form. The
canonical wordmark is the CSS in README.md.

Requires Pillow, which is already installed. No other dependency.
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).parent

# --- The mark ---------------------------------------------------------------
# Three books on a shelf: two leaning toward one standing square, each carrying
# the panel a title is stamped into. Drawn on a 32x32 grid, the same grid every
# icon in this app uses.

BAR_W = 5.5
BAR_GAP = 3.25
BAR_TOP = 10.0
BAR_BASE = 27.0
BAR_RX = 1.3
GRID = 32.0

# Tip angles, in degrees clockwise about the point each book stands on. Chosen at
# the fourth review pass: far enough that the lean is unmistakable at 16px, and
# short of the point where the leading book reads as fallen rather than leaning.
ANGLES = (25.0, 12.0)

# The two leaning books separate from each other by shade rather than by a third
# hue. **They are opaque greys, not the secondary colour at reduced opacity**,
# which is what they were until the shades were found to move.
#
# Opacity is not a shade. It composites against whatever sits behind the mark, so
# one declaration renders a different grey on every surface — the back book
# measures 167 of 255 on the white top bar, 161 on the sidebar, 157 on a hover
# row — and it *inverts* between modes, because fading moves a book toward the
# ground and the ground changes sides. A mark that reads differently depending on
# what it is sitting on is not doing its job, and the two dark-mode bugs that came
# out of this were the same bug twice.
#
# The greys below are the composites the opacity version produced against the
# ground each mode was designed for, so the mark is unchanged where it was
# already right and now identical everywhere else. They are still *derived* from
# the secondary text colour rather than picked by eye, which is the one thing the
# opacity form was actually buying.
# Each pair mixes the mode's secondary text colour toward the mode's ground.
# **The dark pair is not the light pair.** Mixing toward a light ground lightens
# and mixing toward a dark one darkens, so holding the numbers fixed would put
# the back book at the dark end on dark — the mark is read by its shades, back
# book palest, and inverting that ordering is a different mark rather than a
# dimmer one. The numbers are chosen to hold the *ordering* fixed instead, which
# is what they were always standing in for.
LEAN_RATIOS = {"light": (0.55, 0.8), "dark": (1.0, 0.62)}
GROUND = {"light": "#ffffff", "dark": "#202124"}

# The two leaning books drive `Logo.tsx` through custom properties, since the
# theme switches under it at runtime and it cannot pick a mode at generate time.
# The values are mirrored into `client/src/index.css` under `:root` and `.dark`.
BOOK_VARS = ("--logo-book-back", "--logo-book-mid")

# The favicon's equivalent, a plain class rather than a property, because a
# `var()` is one more thing a favicon renderer has to support and buys nothing in
# a file that already carries its own stylesheet.
LEAN_CLASSES = ("b", "m")

# The panel a title is stamped into, a fifth of the way down each spine.
#
# It **lightens** the board rather than darkening it, which matters most on the
# accent: a dark panel on gold reads as a shadow falling across the book, and a
# light one reads as something printed on it. As ratios of the spine, so the
# panel tracks the geometry if that ever changes.
PANEL_INSET = 0.9
PANEL_TOP_RATIO = 0.22
PANEL_HEIGHT_RATIO = 0.30
PANEL_RX = 0.5
PANEL_COLOUR = "#ffffff"
PANEL_OPACITY = 0.38

_BAR_H = BAR_BASE - BAR_TOP
PANEL_Y = BAR_TOP + _BAR_H * PANEL_TOP_RATIO
PANEL_H = _BAR_H * PANEL_HEIGHT_RATIO
PANEL_W = BAR_W - PANEL_INSET * 2

_SPAN = BAR_W * 3 + BAR_GAP * 2
_X0 = (GRID - _SPAN) / 2
BAR_X = (_X0, _X0 + BAR_W + BAR_GAP, _X0 + (BAR_W + BAR_GAP) * 2)

# --- Colour -----------------------------------------------------------------
# The accent is mode-invariant; the two leaning dominoes take the secondary text
# colour, which is not. Values are copied from client/src/index.css and must be
# changed here if they change there.

ACCENT = "#ffab00"
SECONDARY = {"light": "#5f6368", "dark": "#9aa0a6"}

# --- Raster sizes -----------------------------------------------------------
# 16/32/48 are the favicon set, 180 is apple-touch-icon, 192/512 are the web app
# manifest, and 128/256 cover listing and social slots. The app icon adds 120,
# the Google OAuth consent screen logo.

PNG_SIZES = (16, 32, 48, 64, 128, 180, 192, 256, 512)
PNG_DARK_SIZES = (32, 192, 512)

# --- The installed app icon -------------------------------------------------
# The one place the icon sits on a ground we choose rather than on transparency.
#
# A transparent icon lands on whatever the host decides, and for apple-touch-icon
# that is black — where the leaning books, at 55% of a mid grey, all but vanish.
# So the installed-app slots get a light ground baked in: iOS, Android and a
# listing card all show the same tile, and none of them can darken it.
#
# The ground is the app's own canvas rather than pure white, so the icon matches
# the page it opens. **No corner radius is baked in.** Every host that uses these
# applies its own mask, and a rounded tile inside a rounded mask reads as a
# double border.
ICON_GROUND = "#fffdf7"  # --color-canvas, light

# Art as a fraction of the tile. Two numbers because the two slots crop
# differently: a plain icon is shown whole, while a maskable one is cropped to
# whatever shape the launcher wants, guaranteed only to keep the centre circle of
# 80% diameter. A square of side s fits that circle when s <= 0.8/sqrt(2), so
# 0.56 is the largest safe square and the padding it leaves is not optional.
ICON_ART_RATIO = 0.78
ICON_MASKABLE_ART_RATIO = 0.56

APP_ICON_SIZES = (120, 180, 192, 512)
APP_ICON_MASKABLE_SIZES = (192, 512)

SUPERSAMPLE = 1024  # working canvas, downsampled to each target


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def blend(fg: str, bg: str, ratio: float) -> str:
    """`fg` laid over `bg` at `ratio`, resolved once into a literal."""
    f, b = hex_to_rgb(fg), hex_to_rgb(bg)
    return "#%02x%02x%02x" % tuple(round(b[i] + (f[i] - b[i]) * ratio) for i in range(3))


def books(mode: str) -> tuple[str, str, str]:
    """The three spine colours for a mode: back, middle, upright."""
    ground, ratios = GROUND[mode], LEAN_RATIOS[mode]
    return (
        blend(SECONDARY[mode], ground, ratios[0]),
        blend(SECONDARY[mode], ground, ratios[1]),
        ACCENT,
    )


def mark_svg_body(
    mode: str = "light",
    fills: tuple[str, ...] | None = None,
    lean_class: bool = False,
) -> str:
    """
    The three books, as SVG elements.

    `fills` overrides the mode's literal spine colours, for the two callers that
    need something else there: the token version passes custom properties, and
    the favicon passes nothing and takes classes instead (see `lean_class`).

    The spines are **opaque**. Only the title panel is translucent, and it
    composites against the spine rather than against the page — which is why it
    stays inside the book's own group, and why `generate.py` composites it onto
    its own layer before drawing: Pillow's `ImageDraw` replaces pixels rather
    than blending them, so a translucent panel drawn straight onto the spine
    punches a hole in it.
    """
    fills = fills or books(mode)
    parts = []
    for i, x in enumerate(BAR_X):
        fill = fills[i]
        opacity = ""
        transform = ""
        if i < 2:
            cx = x + BAR_W / 2
            transform = f' transform="rotate({ANGLES[i]:g} {cx:g} {BAR_BASE:g})"'
        paint = (
            f'class="{LEAN_CLASSES[i]}"' if lean_class and i < 2 else f'fill="{fill}"'
        )
        spine = (
            f'<rect x="{x:g}" y="{BAR_TOP:g}" width="{BAR_W:g}" '
            f'height="{_BAR_H:g}" rx="{BAR_RX:g}" {paint} />'
        )
        panel = (
            f'<rect x="{x + PANEL_INSET:g}" y="{PANEL_Y:g}" width="{PANEL_W:g}" '
            f'height="{PANEL_H:g}" rx="{PANEL_RX:g}" fill="{PANEL_COLOUR}" '
            f'opacity="{PANEL_OPACITY:g}" />'
        )
        parts.append(f"<g{opacity}{transform}>{spine}{panel}</g>")
    return "\n  ".join(parts)


def ink_bounds(pad: float = 0.6) -> tuple[float, float, float, float]:
    """
    The mark's actual bounding box in grid units, plus a little padding.

    The bars stand on a baseline inside the 32 box rather than filling it, and
    tipping two of them moves ink further still, so the drawn area covers a bit
    over half the frame's height. That is right in a lockup, where the mark has
    to sit on the same line as type — and wrong in an icon slot, where it throws
    away resolution that a 16px favicon cannot spare. Measured off the raster
    rather than derived, because the tipped bars' corners are the extremes and
    solving for them by hand is a good way to be slightly wrong.
    """
    canvas = render_raw("light")
    box = canvas.getbbox()
    assert box is not None
    scale = GRID / SUPERSAMPLE
    x0, y0, x1, y1 = (v * scale for v in box)
    return (x0 - pad, y0 - pad, (x1 - x0) + pad * 2, (y1 - y0) + pad * 2)


def write_mark_svgs() -> None:
    # The token version. This is what Logo.tsx renders, so the two follow the
    # theme together and neither can drift from this file.
    (OUT / "mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n'
        f"  {mark_svg_body(fills=(f'var({BOOK_VARS[0]})', f'var({BOOK_VARS[1]})', ACCENT))}\n</svg>\n",
        encoding="utf-8",
    )

    # Literal-colour versions, for anywhere design tokens do not exist: email,
    # a slide, a document, a third-party listing form.
    for mode in SECONDARY:
        (OUT / f"mark-{mode}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n'
            f"  {mark_svg_body(mode=mode)}\n</svg>\n",
            encoding="utf-8",
        )

    # The favicon carries both modes and switches itself, which is the one place
    # a single file has to work on either ground without being asked. Each
    # leaning book gets its own class and its own literal grey per mode: the two
    # cannot be derived from one another at paint time, which is what the
    # opacity form assumed and what made the mark's shades depend on whatever it
    # was sitting on. Cropped to the ink and squared, for the reason given on
    # `ink_bounds`.
    x, y, w, h = ink_bounds()
    side = max(w, h)
    vb = f"{x + w / 2 - side / 2:.2f} {y + h / 2 - side / 2:.2f} {side:.2f} {side:.2f}"
    (OUT / "favicon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="32" height="32">\n'
        "  <style>\n"
        f"    .{LEAN_CLASSES[0]} {{ fill: {books('light')[0]}; }}\n"
        f"    .{LEAN_CLASSES[1]} {{ fill: {books('light')[1]}; }}\n"
        "    @media (prefers-color-scheme: dark) {\n"
        f"      .{LEAN_CLASSES[0]} {{ fill: {books('dark')[0]}; }}\n"
        f"      .{LEAN_CLASSES[1]} {{ fill: {books('dark')[1]}; }}\n"
        "    }\n"
        "  </style>\n"
        f"  {mark_svg_body(lean_class=True)}\n"
        "</svg>\n",
        encoding="utf-8",
    )


def render_raw(mode: str) -> Image.Image:
    """The mark on the full 32-unit grid, at working resolution."""
    scale = SUPERSAMPLE / GRID
    canvas = Image.new("RGBA", (SUPERSAMPLE, SUPERSAMPLE), (0, 0, 0, 0))

    for i, x in enumerate(BAR_X):
        rgb = hex_to_rgb(books(mode)[i])
        layer = Image.new("RGBA", (SUPERSAMPLE, SUPERSAMPLE), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [x * scale, BAR_TOP * scale, (x + BAR_W) * scale, BAR_BASE * scale],
            radius=BAR_RX * scale,
            fill=(*rgb, 255),
        )

        # The panel goes on its own layer and is composited in. ImageDraw
        # *replaces* pixels rather than blending them, so drawing a translucent
        # panel straight onto the spine punches a hole in it instead of
        # lightening it — which is not what the SVG does, and is exactly the
        # discrepancy that would make the rasters and the vectors disagree.
        panel = Image.new("RGBA", (SUPERSAMPLE, SUPERSAMPLE), (0, 0, 0, 0))
        ImageDraw.Draw(panel).rounded_rectangle(
            [
                (x + PANEL_INSET) * scale,
                PANEL_Y * scale,
                (x + PANEL_INSET + PANEL_W) * scale,
                (PANEL_Y + PANEL_H) * scale,
            ],
            radius=PANEL_RX * scale,
            fill=(*hex_to_rgb(PANEL_COLOUR), round(PANEL_OPACITY * 255)),
        )
        layer = Image.alpha_composite(layer, panel)

        # No group opacity step any more: the spines are opaque literals, so
        # what a raster has to reproduce is the panel over the spine and nothing
        # else. That the PNGs used to need a fade the SVGs expressed differently
        # was the last place the two could disagree.

        if i < 2:
            # PIL rotates counter-clockwise for a positive angle; SVG rotates
            # clockwise. Negate so the two agree.
            cx = (x + BAR_W / 2) * scale
            layer = layer.rotate(
                -ANGLES[i], resample=Image.BICUBIC, center=(cx, BAR_BASE * scale)
            )
        canvas = Image.alpha_composite(canvas, layer)

    return canvas


def render_mark(size: int, mode: str) -> Image.Image:
    """The mark at `size`, on transparency, positioned as it is in a lockup."""
    return render_raw(mode).resize((size, size), Image.LANCZOS)


def render_icon(size: int, mode: str) -> Image.Image:
    """
    The same mark cropped to its own ink and squared up, for icon slots.

    Same artwork, not a second logo: an icon has no type to line up with, so
    there is nothing for the empty half of the frame to be doing.
    """
    x, y, w, h = ink_bounds()
    scale = SUPERSAMPLE / GRID
    side = max(w, h)
    left = (x + w / 2 - side / 2) * scale
    top = (y + h / 2 - side / 2) * scale
    square = render_raw(mode).crop(
        (round(left), round(top), round(left + side * scale), round(top + side * scale))
    )
    return square.resize((size, size), Image.LANCZOS)


def render_app_icon(size: int, art_ratio: float) -> Image.Image:
    """The cropped mark, centred on the solid ground, for an installed-app slot."""
    art = round(size * art_ratio)
    tile = Image.new("RGBA", (size, size), (*hex_to_rgb(ICON_GROUND), 255))
    offset = (size - art) // 2
    tile.alpha_composite(render_icon(art, "light"), (offset, offset))
    return tile


def write_pngs() -> None:
    for size in PNG_SIZES:
        render_mark(size, "light").save(OUT / f"mark-{size}.png")
        render_icon(size, "light").save(OUT / f"icon-{size}.png")
    for size in PNG_DARK_SIZES:
        render_mark(size, "dark").save(OUT / f"mark-dark-{size}.png")
        render_icon(size, "dark").save(OUT / f"icon-dark-{size}.png")

    for size in APP_ICON_SIZES:
        render_app_icon(size, ICON_ART_RATIO).save(OUT / f"app-icon-{size}.png")
    for size in APP_ICON_MASKABLE_SIZES:
        render_app_icon(size, ICON_MASKABLE_ART_RATIO).save(
            OUT / f"app-icon-maskable-{size}.png"
        )

    # A multi-resolution .ico for the one slot that still wants it. Cropped,
    # since a favicon is an icon slot.
    render_icon(256, "light").save(
        OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)]
    )


# --- The wordmark and the lockup --------------------------------------------
# Set in the system font stack, so these files render correctly in a browser and
# approximately anywhere else. Text is not converted to outlines: this project
# uses no custom font by design, and outlining would freeze one machine's idea
# of Segoe UI into an asset the CSS would then disagree with.

FONT_STACK = (
    "-apple-system, BlinkMacSystemFont, &apos;Segoe UI&apos;, Roboto, "
    "&apos;Helvetica Neue&apos;, Arial, sans-serif"
)

# The lockup, as one rule rather than three numbers: at a mark of M, the type is
# 0.625M and the gap is 0.25M. At the 32px both headers use, that is 20px type
# and the 8px gap chosen at review.
LOCKUP_TEXT_RATIO = 0.625
LOCKUP_GAP_RATIO = 0.25


def wordmark_svg(size: int, colour: str) -> str:
    # Width is an estimate: without a font engine there is no way to measure the
    # advance of a stack that resolves differently per machine. Consumers should
    # scale to height, not to width.
    width = round(size * 5.6)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {round(size * 1.35)}" '
        f'width="{width}" height="{round(size * 1.35)}">\n'
        f'  <text x="0" y="{round(size * 1.0)}" font-family="{FONT_STACK}" '
        f'font-size="{size}" letter-spacing="-0.02em" fill="{colour}">'
        f'<tspan font-weight="650">Teach</tspan>'
        f'<tspan font-weight="400">neat</tspan></text>\n'
        "</svg>\n"
    )


def lockup_svg(mark: int, mode: str) -> str:
    text_size = mark * LOCKUP_TEXT_RATIO
    gap = mark * LOCKUP_GAP_RATIO
    width = round(mark + gap + text_size * 5.6)
    height = mark
    colour = "#202124" if mode == "light" else "#e3e3e3"
    body = mark_svg_body(mode=mode)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">\n'
        f'  <g transform="translate(0 0) scale({mark / GRID:g})">\n    {body}\n  </g>\n'
        # The gap is measured box to box, not ink to ink, which is the
        # convention the chosen lockup was judged under: the mark stands on a
        # baseline inside its box rather than filling it, so the visible
        # whitespace runs a little wider than the number.
        f'  <text x="{mark + gap:g}" y="{height / 2 + text_size * 0.36:g}" '
        f'font-family="{FONT_STACK}" font-size="{text_size:g}" letter-spacing="-0.02em" '
        f'fill="{colour}"><tspan font-weight="650">Teach</tspan>'
        f'<tspan font-weight="400">neat</tspan></text>\n'
        "</svg>\n"
    )


def write_type_svgs() -> None:
    for mode, colour in (("light", "#202124"), ("dark", "#e3e3e3")):
        (OUT / f"wordmark-{mode}.svg").write_text(wordmark_svg(20, colour), encoding="utf-8")
        for mark in (32, 56, 72):
            (OUT / f"lockup-{mark}-{mode}.svg").write_text(lockup_svg(mark, mode), encoding="utf-8")


if __name__ == "__main__":
    write_mark_svgs()
    write_pngs()
    write_type_svgs()
    made = sorted(p.name for p in OUT.iterdir() if p.suffix in {".svg", ".png", ".ico"})
    print(f"{len(made)} files written to {OUT}")
    for name in made:
        print("  " + name)
