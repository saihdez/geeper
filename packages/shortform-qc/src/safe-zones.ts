import type { Box, Format, Platform } from "./types.js";

export const CANVAS: Record<Format, { width: number; height: number; safe: Box }> = {
  // Shorts/Reels/TikTok: keep text between the top bar and the caption/buttons area.
  "9:16": { width: 1080, height: 1920, safe: { x: 60, y: 168, w: 960, h: 1162 } },
  // 16:9: the classic 90 % title-safe area.
  "16:9": { width: 1920, height: 1080, safe: { x: 96, y: 54, w: 1728, h: 972 } },
  "1:1": { width: 1080, height: 1080, safe: { x: 54, y: 54, w: 972, h: 972 } },
};

/**
 * Share of a 9:16 frame each platform's UI covers (top, right, bottom, left). Adapted from
 * vincentsch/explainroo `src/project.js` (MIT). Facebook Reels uses the Instagram Reels layout.
 * Snapchat Spotlight: Snap's ad specs recommend keeping 150px clear at the top and bottom
 * (https://businesshelp.snapchat.com/s/article/commercial-specs). Spotlight's own UI covers more of
 * the bottom and the right edge, so these margins are wider: 150px top / 360px bottom / 65px left /
 * 162px right, measured from Spotlight templates by a third party
 * (https://shotcraft.video/reference/platform-safe-zones/).
 * Pinterest (vertical video Pins): 270px top / 790px bottom / 65px left / 195px right on 1080x1920,
 * from Pinterest's organic Pin specs (https://help.pinterest.com/en/article/review-pin-specs).
 * Pinterest's ad specs use a 440px bottom margin for Idea ads
 * (https://help.pinterest.com/en/business/article/pinterest-product-specs); the organic value is
 * used here because the other platforms in this table are organic layouts too.
 */
export const PLATFORM_UI_9X16: Record<Platform, { top: number; right: number; bottom: number; left: number }> = {
  tiktok: { top: 0.125, right: 0.2, bottom: 0.34, left: 0.11 },
  youtube: { top: 0.15, right: 0.12, bottom: 0.35, left: 0.06 },
  instagram: { top: 0.14, right: 0.11, bottom: 0.35, left: 0.06 },
  facebook: { top: 0.14, right: 0.11, bottom: 0.35, left: 0.06 },
  snapchat: { top: 0.078, right: 0.15, bottom: 0.188, left: 0.06 },
  pinterest: { top: 0.141, right: 0.181, bottom: 0.411, left: 0.06 },
};

export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

/** Area a platform's UI leaves visible in a 9:16 frame, in pixels. */
export function platformZone(platform: Platform, width = 1080, height = 1920): Box {
  const z = PLATFORM_UI_9X16[platform];
  return { x: z.left * width, y: z.top * height, w: width * (1 - z.left - z.right), h: height * (1 - z.top - z.bottom) };
}

/** Safe zone for a format; in 9:16 it is the intersection with what every target platform leaves visible. */
export function safeZone(format: Format, platforms: readonly Platform[] = []): Box {
  const c = CANVAS[format];
  if (format !== "9:16" || platforms.length === 0) return c.safe;
  let s = c.safe;
  for (const p of platforms) s = intersect(s, platformZone(p, c.width, c.height));
  return { x: Math.round(s.x), y: Math.round(s.y), w: Math.floor(s.w), h: Math.floor(s.h) };
}

/** Half-pixel tolerance for layouts computed with fractional coordinates. */
export function inside(box: Box, zone: Box): boolean {
  return box.x >= zone.x - 0.5 && box.y >= zone.y - 0.5 && box.x + box.w <= zone.x + zone.w + 0.5 && box.y + box.h <= zone.y + zone.h + 0.5;
}
