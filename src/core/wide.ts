/**
 * Layout on a wide window (an iPad in landscape, the app in a Mac window): how wide a screen's
 * content column is, and when a panel fits beside it. Pure, so it's tested; a screen reads the
 * window's width and asks here, so every screen splits at the same width.
 */

/** A screen's content column on a wide display: rows stop here, centered (`readable` in src/ui/theme.ts). */
export const READABLE_WIDTH = 640;

/** A panel beside the content column: the word tapped in Read & Listen. */
export const SIDE_PANEL_WIDTH = 320;

/** The least space left on each side of the column once a panel is beside it. */
const GUTTER = 20;

/** The least a column is worth reading at when a screen splits into two (Today), and the gap and margins around them. */
const MIN_COLUMN = 356;
const COLUMN_GAPS = 48;

/**
 * Whether a screen `width` wide has room for two columns side by side. `width` is what the screen
 * itself has: on an iPad the tab bar's sidebar takes part of the window.
 */
export function twoColumnsFit(width: number): boolean {
  return width >= 2 * MIN_COLUMN + COLUMN_GAPS;
}

/** The most a screen in two columns spreads to: two full content columns and what's around them. Its scroll view stops here, centered. */
export const TWO_COLUMNS_WIDTH = 2 * READABLE_WIDTH + COLUMN_GAPS;

/** Whether the window has room for the full content column and a panel beside it. */
export function sidePanelFits(windowWidth: number): boolean {
  return windowWidth >= READABLE_WIDTH + SIDE_PANEL_WIDTH + 2 * GUTTER;
}

/**
 * How far from the window's left and right edges something floating over the content column
 * (a popup) starts and ends, so it lines up with the column: at least `margin` on a narrow window,
 * and the column's own edges on a wide one. `panel` is the width a side panel takes on the right.
 */
export function columnInsets(windowWidth: number, margin: number, panel = 0): { left: number; right: number } {
  const side = Math.max(margin, (windowWidth - panel - READABLE_WIDTH) / 2);
  return { left: side, right: side + panel };
}
