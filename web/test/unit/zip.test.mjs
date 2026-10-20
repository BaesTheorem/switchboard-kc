// lib/zip.js against Zip in ios/KC311/Sources/ReportDraft.swift. The
// reference writer below follows Zip.store step for step, with node:zlib's
// CRC-32, so it shares no code with zip.js.

import assert from "node:assert/strict";
import test from "node:test";
import { crc32 as zlibCrc32 } from "node:zlib";
import { crc32, readZip, zipStore } from "../../public/js/lib/zip.js";

/** Zip.store from ReportDraft.swift: [[name, Uint8Array]] to the ZIP bytes. */
function swiftZipStore(entries) {
  const out = [];
  const central = [];
  const le16 = (v, d) => d.push(v & 0xff, (v >>> 8) & 0xff);
  const le32 = (v, d) => d.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const [name, data] of entries) {
    const offset = out.length;
    const crc = zlibCrc32(data);
    const n = [...new TextEncoder().encode(name)];
    le32(0x04034b50, out); le16(20, out); le16(0, out); le16(0, out); le16(0, out); le16(0x21, out);
    le32(crc, out); le32(data.length, out); le32(data.length, out);
    le16(n.length, out); le16(0, out); out.push(...n, ...data);
    le32(0x02014b50, central); le16(20, central); le16(20, central); le16(0, central); le16(0, central);
    le16(0, central); le16(0x21, central); le32(crc, central); le32(data.length, central);
    le32(data.length, central); le16(n.length, central); le16(0, central); le16(0, central);
    le16(0, central); le16(0, central); le32(0, central); le32(offset, central); central.push(...n);
  }
  const cdOffset = out.length;
  out.push(...central);
  le32(0x06054b50, out); le16(0, out); le16(0, out); le16(entries.length, out); le16(entries.length, out);
  le32(central.length, out); le32(cdOffset, out); le16(0, out);
  return new Uint8Array(out);
}

/** n bytes of fixed noise. */
function bytes(n, seed) {
  const a = new Uint8Array(n);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = x >>> 24; }
  return a;
}

const ENTRIES = [["CAM1791232365000.jpeg", bytes(300, 1)], ["CAM1791232365001.jpeg", bytes(17, 2)], ["notes.txt", new TextEncoder().encode("A pothole.")]];

test("crc32 of \"123456789\" is 0xCBF43926", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const noise = bytes(1000, 7);
  assert.equal(crc32(noise), zlibCrc32(noise));
});

test("zipStore writes the same bytes as Zip.store in ReportDraft.swift", async () => {
  const blob = zipStore(ENTRIES.map(([name, data]) => ({ name, data })));
  assert.equal(blob.type, "application/zip");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), swiftZipStore(ENTRIES));
});

test("readZip reads back what zipStore wrote", async () => {
  const blob = zipStore(ENTRIES.map(([name, data]) => ({ name, data })));
  const all = await readZip(await blob.arrayBuffer());
  assert.deepEqual([...all.keys()], ENTRIES.map(([name]) => name));
  for (const [name, data] of ENTRIES) assert.deepEqual(all.get(name), data, name);

  // A filter, and a Uint8Array that does not start at offset 0 of its buffer.
  const raw = new Uint8Array(await blob.arrayBuffer());
  const shifted = new Uint8Array(raw.length + 5);
  shifted.set(raw, 5);
  const jpegs = await readZip(shifted.subarray(5), (name) => name.endsWith(".jpeg"));
  assert.deepEqual([...jpegs.keys()], ["CAM1791232365000.jpeg", "CAM1791232365001.jpeg"]);
  assert.deepEqual(jpegs.get("CAM1791232365001.jpeg"), ENTRIES[1][1]);
});

test("an empty ZIP round trip", async () => {
  const blob = zipStore([]);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), swiftZipStore([]));
  assert.equal((await readZip(await blob.arrayBuffer())).size, 0);
});

test("readZip refuses a file that is not a ZIP", async () => {
  await assert.rejects(readZip(new Uint8Array(100)), /not a zip file/);
  await assert.rejects(readZip(new Uint8Array(10)), /not a zip file/);
});
