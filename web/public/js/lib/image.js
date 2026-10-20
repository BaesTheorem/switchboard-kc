// A picked or taken photo, scaled the way the official app sends it: the
// longest side at most 1000 px, JPEG at 85 %.

import { exifGps } from "./exif.js";

export async function preparePhoto(file, maxSide = 1000) {
  const buf = await file.arrayBuffer();
  let gps = null;
  try { gps = exifGps(buf); } catch { gps = null; }
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // naturalWidth/Height already follow the EXIF orientation in current browsers.
    const f = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * f), h = Math.round(img.naturalHeight * f);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the photo."))), "image/jpeg", 0.85));
    return { blob, gps };
  } finally {
    URL.revokeObjectURL(src);
  }
}
