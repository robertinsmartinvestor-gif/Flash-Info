import { pngSize } from "@/src/media/cover-spec";

/** Inputs of the manual thumbnail workflow, checked before they reach YouTube or Storage. */
export function parseThumbnailInput(videoId: string, storagePath: string): { videoId: string; storagePath: string } {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error("thumbnail_bad_video_id");
  // Only PNG covers in the private bucket's thumbnail folder, no path tricks.
  if (!/^thumbnail\/[\w-]+(\/[\w-]+)*\.png$/.test(storagePath)) throw new Error("thumbnail_bad_path");
  return { videoId, storagePath };
}

/** thumbnails.set accepts up to 50 MB; covers stay within 2 MB like the rendered ones. */
const MAX_BYTES = 2 * 1024 * 1024;

/** A vertical PNG of at least 720 px width, within 2 MB, or a code saying why not. */
export function checkThumbnailFile(bytes: Uint8Array): string | null {
  const size = pngSize(bytes);
  if (!size) return "thumbnail_not_png";
  if (bytes.byteLength > MAX_BYTES) return "thumbnail_too_large";
  if (size.width < 720 || Math.abs(size.width / size.height - 9 / 16) > 0.01) return "thumbnail_wrong_shape";
  return null;
}
