// Starting a topic from an image (Your topics, New topic): a photo of a grammar book's page or a
// screenshot is sent to the server, which has Claude name the grammar point it's about; that fills
// the New topic screen's title. Pure, so it's tested; the picking itself is src/ui/TopicImagePicker.tsx.
// The image only seeds the title: the page is written and checked as a typed topic is, nothing is
// graded, and the image isn't kept on the phone or the server.

/** The longest side sent, in pixels: enough to read a book page's print, far under what a camera takes. */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.7;
/** The server refuses more base64 text than this (topic_image.MAX_IMAGE_CHARS). */
export const MAX_IMAGE_CHARS = 6_000_000;

/**
 * The size to shrink an image to so its longest side is `MAX_SIDE`, keeping its proportions: the width
 * or the height alone (the other follows), or null when it's already small enough. A size the system
 * didn't report (0) is shrunk by width, which is right for a portrait photo and harmless otherwise.
 */
export function resizeTo(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= MAX_SIDE && width > 0 && height > 0) return null;
  return height > width ? { height: MAX_SIDE } : { width: MAX_SIDE };
}

/** The base64 text of a `data:image/...;base64,` string, as the clipboard returns an image. */
export function base64Of(dataUri: string): string {
  const at = dataUri.indexOf(',');
  return dataUri.startsWith('data:') && at >= 0 ? dataUri.slice(at + 1) : dataUri;
}

/** Whether the server will take this much base64 text. */
export function fitsServer(base64: string): boolean {
  return base64.length > 0 && base64.length <= MAX_IMAGE_CHARS;
}
