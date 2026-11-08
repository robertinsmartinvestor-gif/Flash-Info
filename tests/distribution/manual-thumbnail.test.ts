import { describe, expect, it } from "vitest";
import { checkThumbnailFile, parseThumbnailInput } from "@/src/distribution/manual-thumbnail";

const png = (width: number, height: number, extra = 0) => {
  const bytes = new Uint8Array(24 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

describe("parseThumbnailInput", () => {
  it("accepts a YouTube id and a PNG in the thumbnail folder", () => {
    expect(parseThumbnailInput("kJVCp1YAWGg", "thumbnail/manual/kJVCp1YAWGg.png")).toEqual({ videoId: "kJVCp1YAWGg", storagePath: "thumbnail/manual/kJVCp1YAWGg.png" });
  });

  it.each([
    ["x; rm -rf /", "thumbnail/a.png", "thumbnail_bad_video_id"],
    ["kJVCp1YAWGg", "audio/a.mp3", "thumbnail_bad_path"],
    ["kJVCp1YAWGg", "thumbnail/../video/a.png", "thumbnail_bad_path"],
    ["kJVCp1YAWGg", "thumbnail/a.png?x=1", "thumbnail_bad_path"],
  ])("refuses %s / %s", (videoId, path, code) => {
    expect(() => parseThumbnailInput(videoId, path)).toThrow(code);
  });
});

describe("checkThumbnailFile", () => {
  it("accepts a vertical 9:16 PNG within 2 MB", () => {
    expect(checkThumbnailFile(png(1080, 1920))).toBeNull();
  });

  it("refuses other files, shapes and sizes", () => {
    expect(checkThumbnailFile(new Uint8Array([1, 2, 3]))).toBe("thumbnail_not_png");
    expect(checkThumbnailFile(png(1920, 1080))).toBe("thumbnail_wrong_shape");
    expect(checkThumbnailFile(png(360, 640))).toBe("thumbnail_wrong_shape");
    expect(checkThumbnailFile(png(1080, 1920, 3 * 1024 * 1024))).toBe("thumbnail_too_large");
  });
});
