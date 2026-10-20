// lib/exif.js against Place.gps(in:) in ios/KC311/Sources/Place.swift: the
// GPS latitude and longitude, negative for S and W. The JPEGs are built here
// byte by byte: SOI, an APP0 JFIF block, an APP1 Exif block whose IFD0 points
// to a GPS IFD, then SOS and EOI.

import assert from "node:assert/strict";
import test from "node:test";
import { exifGps } from "../../public/js/lib/exif.js";

const JFIF = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const TAIL = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9];

/** A TIFF block with a GPS IFD. lat and lng are three [numerator, denominator] rationals. */
function tiff({ le, latRef, lat, lngRef, lng }) {
  const ifd0 = 8;
  const gps = ifd0 + 2 + 12 + 4;
  const data = gps + 2 + 4 * 12 + 4;
  const v = new DataView(new ArrayBuffer(data + 6 * 8));
  const w16 = (o, x) => v.setUint16(o, x, le);
  const w32 = (o, x) => v.setUint32(o, x, le);
  v.setUint8(0, le ? 0x49 : 0x4d);
  v.setUint8(1, le ? 0x49 : 0x4d);
  w16(2, 42);
  w32(4, ifd0);
  w16(ifd0, 1);
  w16(ifd0 + 2, 0x8825); w16(ifd0 + 4, 4); w32(ifd0 + 6, 1); w32(ifd0 + 10, gps);   // GPSInfo, LONG
  w32(ifd0 + 14, 0);
  w16(gps, 4);
  const entry = (i, tag, type, count) => {
    const e = gps + 2 + i * 12;
    w16(e, tag); w16(e + 2, type); w32(e + 4, count);
    return e + 8;
  };
  v.setUint8(entry(0, 1, 2, 2), latRef.charCodeAt(0));   // GPSLatitudeRef, ASCII "N\0"
  w32(entry(1, 2, 5, 3), data);                          // GPSLatitude, 3 RATIONAL
  v.setUint8(entry(2, 3, 2, 2), lngRef.charCodeAt(0));   // GPSLongitudeRef
  w32(entry(3, 4, 5, 3), data + 24);                     // GPSLongitude
  w32(gps + 2 + 4 * 12, 0);
  [...lat, ...lng].forEach(([n, d], i) => { w32(data + i * 8, n); w32(data + i * 8 + 4, d); });
  return [...new Uint8Array(v.buffer)];
}

function jpeg(gps) {
  const t = tiff(gps);
  const len = 2 + 6 + t.length;
  const app1 = [0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...t];
  return new Uint8Array([0xff, 0xd8, ...JFIF, ...app1, ...TAIL]).buffer;
}

// Kansas City City Hall, 39 deg 5' 59" N, 94 deg 34' 43" W, with the seconds as 5900/100.
const KC = { latRef: "N", lat: [[39, 1], [5, 1], [5900, 100]], lngRef: "W", lng: [[94, 1], [34, 1], [43, 1]] };
const KC_LAT = 39 + 5 / 60 + 59 / 3600;
const KC_LNG = -(94 + 34 / 60 + 43 / 3600);

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("exifGps reads N and W from a little-endian (II) Exif block", () => {
  const g = exifGps(jpeg({ le: true, ...KC }));
  assert.ok(near(g.lat, KC_LAT), String(g.lat));
  assert.ok(near(g.lng, KC_LNG), String(g.lng));
});

test("exifGps reads N and W from a big-endian (MM) Exif block", () => {
  const g = exifGps(jpeg({ le: false, ...KC }));
  assert.ok(near(g.lat, KC_LAT), String(g.lat));
  assert.ok(near(g.lng, KC_LNG), String(g.lng));
});

test("exifGps: S makes the latitude negative and E keeps the longitude positive", () => {
  const sydney = { latRef: "S", lat: [[33, 1], [52, 1], [0, 1]], lngRef: "E", lng: [[151, 1], [12, 1], [30, 1]] };
  for (const le of [true, false]) {
    const g = exifGps(jpeg({ le, ...sydney }));
    assert.ok(near(g.lat, -(33 + 52 / 60)), String(g.lat));
    assert.ok(near(g.lng, 151 + 12 / 60 + 30 / 3600), String(g.lng));
  }
});

test("exifGps reads a Uint8Array that does not start at offset 0 of its buffer", () => {
  // Swift reads any Data, a slice included.
  const file = new Uint8Array(jpeg({ le: true, ...KC }));
  const big = new Uint8Array(file.length + 7);
  big.set(file, 7);
  const g = exifGps(big.subarray(7));
  assert.ok(g, "found the GPS block");
  assert.ok(near(g.lat, KC_LAT) && near(g.lng, KC_LNG));
});

test("exifGps gives null for a JPEG without Exif, and for a file that is not a JPEG", () => {
  assert.equal(exifGps(new Uint8Array([0xff, 0xd8, ...JFIF, ...TAIL]).buffer), null);
  const xmp = [0xff, 0xe1, 0x00, 0x0c, 0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x2e];   // APP1 "http://ns."
  assert.equal(exifGps(new Uint8Array([0xff, 0xd8, ...xmp, ...TAIL]).buffer), null);
  assert.equal(exifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer), null);
  assert.equal(exifGps(new ArrayBuffer(0)), null);
});
