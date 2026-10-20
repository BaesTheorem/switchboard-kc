// ZIP files, both ways, with no dependency.
// - zipStore: the photo ZIP the city expects (stored entries; JPEGs do not compress).
// - readZip:  entries from an APK or the GTFS feed (stored or deflated), read
//             from the central directory and inflated with DecompressionStream.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Uint8Array }] → a Blob of a stored-entry ZIP. */
export function zipStore(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const n = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0, true);
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, n.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), n, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, n.length, true);
    cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Entries whose names pass `want(name)`, as a Map of name → Uint8Array.
 * Reads the central directory, so it needs the whole file in memory.
 */
export async function readZip(buf, want = () => true) {
  const z = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  if (z.length < 22) throw new Error("The download is not a zip file.");
  let eocd = z.length - 22;
  const floor = Math.max(0, z.length - 66000);
  while (eocd > floor && u32(eocd) !== 0x06054b50) eocd--;
  if (u32(eocd) !== 0x06054b50) throw new Error("The download is not a zip file.");
  const count = u16(eocd + 10);
  let p = u32(eocd + 16);
  const dec = new TextDecoder();
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) break;
    const method = u16(p + 10), csize = u32(p + 20);
    const nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32), local = u32(p + 42);
    const name = dec.decode(z.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const body = z.subarray(start, start + csize);
    if (method === 0) out.set(name, body.slice());
    else if (method === 8) out.set(name, await inflateRaw(body));
  }
  return out;
}
