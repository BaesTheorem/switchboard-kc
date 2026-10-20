// GPS from a JPEG's EXIF block, if the photo has one. Some browsers remove
// location data from picked photos; then this returns null and the app uses
// the device position.

export function exifGps(buf) {
  // A typed array can start part way into its buffer (a subarray, a Node Buffer).
  const v = buf instanceof ArrayBuffer ? new DataView(buf) : new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    const size = v.getUint16(p + 2);
    if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return tiff(v, p + 10); // "Exif"
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    p += 2 + size;
  }
  return null;
}

function tiff(v, t) {
  if (t + 8 > v.byteLength) return null;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const ifd0 = u32(4);
  const n0 = u16(ifd0);
  let gpsIfd = 0;
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsIfd = u32(e + 8);
  }
  if (!gpsIfd) return null;
  const tags = {};
  const n = u16(gpsIfd);
  for (let i = 0; i < n; i++) {
    const e = gpsIfd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (tag === 1 || tag === 3) tags[tag] = String.fromCharCode(v.getUint8(t + e + 8));
    if ((tag === 2 || tag === 4) && type === 5 && count === 3) {
      const off = u32(e + 8);
      const r = (k) => { const d = u32(off + k * 8 + 4); return d ? u32(off + k * 8) / d : 0; };
      tags[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  if (tags[2] == null || tags[4] == null) return null;
  const lat = tags[1] === "S" ? -tags[2] : tags[2];
  const lng = tags[3] === "W" ? -tags[4] : tags[4];
  if (!lat && !lng) return null;
  return { lat, lng };
}
