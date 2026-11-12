// Keeping the line being spoken on screen: where to scroll, or null when it's already in view.
// Lines are measured in the scroll view's content, so their `y` and the scroll offset compare.
export type Box = { y: number; height: number };

/**
 * The scroll view's frame: its height, and how much of its top the header covers. The header is
 * translucent, so the frame runs up under it and iOS insets the content by the overlap
 * (`contentInsetAdjustmentBehavior="automatic"`): at the top, the scroll offset is `-insetTop`,
 * not 0, and a line scrolled to the frame's top edge sits under the header.
 */
export type Frame = { height: number; insetTop: number };

export function scrollTarget(line: Box, scrollY: number, frame: Frame, margin = 16): number | null {
  const top = scrollY + frame.insetTop;
  const fits = line.y >= top && line.y + line.height <= scrollY + frame.height;
  return fits ? null : Math.max(line.y - margin, 0) - frame.insetTop;
}
