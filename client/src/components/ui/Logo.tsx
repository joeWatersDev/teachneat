/**
 * The Teachneat mark: three books on a shelf, two leaning toward one standing
 * square, each carrying the panel a title is stamped into. It replaces the
 * pencil-ruler-protractor multi-tool, which was a visual pun on "Teacher
 * Toolkit" and stopped meaning anything at the rename.
 *
 * `design/brand/README.md` is authoritative for the geometry, and
 * `design/brand/mark.svg` is the generated reference this component tracks.
 * Change `design/brand/generate.py` and re-run it rather than editing numbers
 * here in isolation.
 *
 * Three details are load-bearing rather than incidental:
 *
 * - **All three books are the same size.** Varying heights and widths says
 *   "books" more loudly and costs the reading of three identical objects.
 * - **The spines are opaque greys, not one colour at two opacities.** Opacity
 *   composites against whatever is behind the mark, so the same declaration
 *   rendered a different grey on the top bar, the sidebar and a hover row, and
 *   inverted its ordering in dark mode. Only the panel is translucent, and it
 *   composites against the spine rather than against the page.
 * - **The upright book takes the accent, and nothing else does.** The mark says
 *   the tidy one is holding the others up.
 *
 * The panel disappears below about 32px by design: it is a 5.1-unit shape on a
 * 32-unit grid, so at favicon sizes the mark degrades to three plain leaning
 * spines, which is the version it started as.
 *
 * Colours come from design tokens rather than literals, so the mark follows the
 * theme like everything else. It is decorative wherever a wordmark sits beside
 * it, which is why `title` is optional and omitted by default.
 */
export function Logo({
  size = 32,
  title,
  className = '',
}: {
  size?: number;
  title?: string;
  /**
   * Sizing utilities, for the places that need the mark to grow with the
   * viewport. A width or height class here overrides the `size` attributes
   * below, which then act as the small-screen default.
   */
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`shrink-0 ${className}`}
    >
      {/* Leaning book, 25°. The palest of the three in both modes. */}
      <g transform="rotate(25 7.25 27)">
        <rect x="4.5" y="10" width="5.5" height="17" rx="1.3" fill="var(--logo-book-back)" />
        <rect x="5.4" y="13.74" width="3.7" height="5.1" rx="0.5" fill="#ffffff" opacity="0.38" />
      </g>
      {/* Leaning book, 12°. */}
      <g transform="rotate(12 16 27)">
        <rect x="13.25" y="10" width="5.5" height="17" rx="1.3" fill="var(--logo-book-mid)" />
        <rect x="14.15" y="13.74" width="3.7" height="5.1" rx="0.5" fill="#ffffff" opacity="0.38" />
      </g>
      {/* The upright book. */}
      <g>
        <rect x="22" y="10" width="5.5" height="17" rx="1.3" fill="var(--color-accent)" />
        <rect x="22.9" y="13.74" width="3.7" height="5.1" rx="0.5" fill="#ffffff" opacity="0.38" />
      </g>
    </svg>
  );
}
