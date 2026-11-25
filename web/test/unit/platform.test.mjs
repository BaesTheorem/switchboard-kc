// lib/platform.js and install.js: which device and browser the app runs in,
// the Home Screen steps for it, and when the launch sheet is due. The user
// agent strings are real ones: Safari's from the WebKit blog ("WebKit Features
// in Safari 26.0"), the in-app browsers' from the test corpus of inapp-spy
// (MIT), the others from the browsers themselves.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kept = new Map();
globalThis.localStorage = {
  getItem: (k) => (kept.has(k) ? kept.get(k) : null),
  setItem: (k, v) => { kept.set(k, String(v)); },
  removeItem: (k) => { kept.delete(k); },
};
const { platform } = await import("../../public/js/lib/platform.js");
const { ASK_AGAIN, inAppNote, installSteps, launchDue } = await import("../../public/js/install.js");

const WEBKIT = "AppleWebKit/605.1.15 (KHTML, like Gecko)";
const IPHONE = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) ${WEBKIT}`;
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36";
const UA = {
  safari18: `${IPHONE} Version/18.6 Mobile/15E148 Safari/604.1`,
  safari26: `${IPHONE} Version/26.0 Mobile/15E148 Safari/604.1`,
  safari27: `${IPHONE} Version/27.1 Mobile/15E148 Safari/604.1`,
  ipadOld: `Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) ${WEBKIT} Version/12.1 Mobile/15E148 Safari/604.1`,
  macSafari: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${WEBKIT} Version/26.0 Safari/605.1.15`,
  chromeIOS: `${IPHONE} CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1`,
  firefoxIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} FxiOS/130.1  Mobile/15E148 Safari/605.1.15`,
  edgeIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} EdgiOS/128.0.2739.82 Version/18.0 Mobile/15E148 Safari/604.1`,
  duckIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} Version/18.1 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15`,
  facebookIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} Mobile/22B83 [FBAN/FBIOS;FBAV/488.0.0.68.101;FBBV/658219612;FBDV/iPhone12,8;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/2;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0;IABMV/1]`,
  messengerIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} Mobile/15E148 [FBAN/FBIOS;FBAV/482.2.0.68.110;FBBV/658316928;FBDV/iPhone12,8;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/2;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]`,
  instagramIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${WEBKIT} Mobile/22F76 Instagram 393.1.0.36.70 (iPhone15,3; iOS 18_5; en_US; en; scale=3.00; 1290x2796; IABMV/1; 776538208) Safari/604.1)`,
  linkedinIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} Mobile/15E148 [LinkedInApp]/9.30.1753`,
  tiktokIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) ${WEBKIT} Mobile/15E148 Safari/604.1 musical_ly_41.9.0`,
  xIOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 10_2_1 like Mac OS X) AppleWebKit/602.3.12 (KHTML, like Gecko) Mobile/14D27 Twitter for iPhone",
  googleIOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ${WEBKIT} GSA/334.0.674067880 Mobile/15E148 Safari/604.1`,
  webviewIOS: `${IPHONE} Mobile/15E148`,   // an app's web view with no name, and also the Home Screen app itself
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Mobile Safari/537.36",
  chromeTablet: "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/21.0 Chrome/110.0.5481.154 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/114.0 Firefox/114.0",
  edgeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
  facebookAndroid: `${PIXEL} [FB_IAB/FB4A;FBAV/488.0.0.62.79;IABMV/1;]`,
  messengerAndroid: `${PIXEL} [FB_IAB/FB4A;FBAV/482.0.0.71.108;]`,
  instagramAndroid: `${PIXEL} Instagram 355.1.0.44.103 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; en_US; 658190016)`,
  webviewAndroid: PIXEL,
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36",
};
const at = (userAgent, more = {}) => platform({ userAgent, maxTouchPoints: 0, ...more });
const text = (steps) => steps.map(String).join("\n");

test("Safari on iPhone gives its version in Version/NN (the system version stays at 18_6)", () => {
  for (const [ua, version] of [[UA.safari18, 18], [UA.safari26, 26], [UA.safari27, 27]]) {
    assert.deepEqual(at(ua), { os: "ios", mobile: true, ipad: false, browser: "safari", version, app: "" });
  }
});

test("an iPad is a phone-class device, and a Mac is not", () => {
  assert.deepEqual(at(UA.macSafari, { maxTouchPoints: 5 }), { os: "ios", mobile: true, ipad: true, browser: "safari", version: 26, app: "" });
  assert.deepEqual(at(UA.ipadOld), { os: "ios", mobile: true, ipad: true, browser: "safari", version: 12, app: "" });
  assert.deepEqual(at(UA.macSafari), { os: "other", mobile: false, ipad: false, browser: "other", version: 0, app: "" });
  assert.equal(at(UA.chromeWindows).mobile, false);
});

test("other browsers on iPhone are not Safari", () => {
  assert.equal(at(UA.chromeIOS).browser, "chrome");
  for (const ua of [UA.firefoxIOS, UA.edgeIOS, UA.duckIOS]) assert.equal(at(ua).browser, "other");
  // Brave sends Safari's user agent and names itself in the navigator.
  assert.equal(at(UA.safari26, { brave: {} }).browser, "other");
  for (const ua of [UA.chromeIOS, UA.firefoxIOS, UA.edgeIOS, UA.duckIOS]) assert.equal(at(ua).version, 0);
});

test("a browser inside another app is found, with the app's name", () => {
  for (const [ua, app] of [[UA.facebookIOS, "Facebook"], [UA.messengerIOS, "Messenger"], [UA.instagramIOS, "Instagram"], [UA.linkedinIOS, "LinkedIn"], [UA.tiktokIOS, "TikTok"],
    [UA.xIOS, "X"], [UA.googleIOS, "The Google app"], [UA.webviewIOS, ""], [UA.facebookAndroid, "Facebook"], [UA.messengerAndroid, "Messenger"],
    [UA.instagramAndroid, "Instagram"], [UA.webviewAndroid, ""]]) {
    const p = at(ua);
    assert.equal(p.browser, "inapp", ua);
    assert.equal(p.app, app, ua);
    assert.equal(p.mobile, true);
  }
});

test("Android: Chrome, and the browsers with their own menus", () => {
  assert.deepEqual(at(UA.chromeAndroid), { os: "android", mobile: true, ipad: false, browser: "chrome", version: 0, app: "" });
  assert.equal(at(UA.chromeTablet).browser, "chrome");
  for (const ua of [UA.samsung, UA.firefoxAndroid, UA.edgeAndroid]) assert.deepEqual(at(ua), { os: "android", mobile: true, ipad: false, browser: "other", version: 0, app: "" });
});

test("no navigator and an empty user agent are a computer", () => {
  assert.equal(platform(undefined).mobile, false);
  assert.equal(platform({}).os, "other");
});

test("Safari's steps follow where each version keeps Share", () => {
  const s27 = text(installSteps(at(UA.safari27))), s26 = text(installSteps(at(UA.safari26))), s18 = text(installSteps(at(UA.safari18)));
  assert.match(s27, /Tap the <i[^>]*>notes<\/i> menu button in Safari's toolbar, then tap <span class="strong">Share<\/span>\./);
  assert.match(s26, /Tap the <i[^>]*>more_horiz<\/i> menu button in Safari's toolbar, then tap <span class="strong">Share<\/span>\./);
  // The Bottom and Top tab layouts keep the Share button, so both versions name it too.
  for (const s of [s26, s27]) { assert.match(s, /If the toolbar has the <i[^>]*>ios_share<\/i> Share button, tap that\./); assert.match(s, /Open as Web App/); }
  assert.match(s18, /^Tap the <i[^>]*>ios_share<\/i> Share button in Safari's toolbar\./);
  assert.doesNotMatch(s18, /Open as Web App|menu button/);
  // The iPad keeps the Share button in its toolbar in every version.
  const pad = text(installSteps(at(UA.macSafari, { maxTouchPoints: 5 })));
  assert.match(pad, /^Tap the <i[^>]*>ios_share<\/i> Share button in Safari's toolbar\./);
  assert.match(pad, /Open as Web App/);
  for (const s of [s18, s26, s27, pad]) assert.match(s, /Add to Home Screen/);
});

test("each other browser gets its own first step", () => {
  assert.match(text(installSteps(at(UA.chromeIOS))), /at the right of Chrome's address bar/);
  assert.match(text(installSteps(at(UA.firefoxIOS))), /Open this browser's <i[^>]*>ios_share<\/i> Share menu\./);
  const chrome = text(installSteps(at(UA.chromeAndroid)));
  assert.match(chrome, /Tap the <i[^>]*>more_vert<\/i> menu button at the right of Chrome's address bar\./);
  assert.match(chrome, /Install and create shortcut/);
  assert.match(text(installSteps(at(UA.samsung))), /menu button of the browser\./);
  assert.match(text(installSteps(at(UA.chromeWindows))), /menu button at the top of the browser\./);
});

test("an in-app browser gets the way to a real browser", () => {
  const ios = at(UA.instagramIOS), android = at(UA.facebookAndroid);
  assert.match(text(installSteps(ios)), /Open in Safari/);
  assert.doesNotMatch(text(installSteps(ios)), /Add to Home Screen<\/span>/);
  assert.match(text(installSteps(android)), /Open in Chrome/);
  assert.match(String(inAppNote(ios)), /Instagram's built-in browser cannot add an app to the Home Screen\. Open this page in Safari first\./);
  assert.match(String(inAppNote(android)), /Facebook's built-in browser .* Open this page in your browser first\./);
  assert.match(String(inAppNote(at(UA.webviewIOS))), /^<p class="sub">This app's built-in browser/);
  assert.equal(inAppNote(at(UA.safari26)), "");
});

test("no icon stands alone before a period, a comma or the end of a step", () => {
  // Such an icon can go to the next line with only the period (it did on a 390 px screen).
  for (const [key, ua] of Object.entries(UA)) {
    for (const more of [{}, { maxTouchPoints: 5 }]) {
      for (const step of installSteps(at(ua, more))) assert.doesNotMatch(String(step), /<\/i>\s*(?:[.,]|$|<span class="hint">)/, `${key}: ${step}`);
    }
  }
});

test("every icon in the steps is in the icon font", () => {
  const font = new Set(JSON.parse(readFileSync(new URL("../../public/vendor/icons.json", import.meta.url), "utf8")));
  for (const [key, ua] of Object.entries(UA)) {
    for (const more of [{}, { maxTouchPoints: 5 }]) {
      for (const m of text(installSteps(at(ua, more))).matchAll(/<i[^>]*>([a-z0-9_]+)<\/i>/g)) assert.ok(font.has(m[1]), `${key}: ${m[1]}`);
    }
  }
});

test("the launch sheet is due in a phone browser tab, and not for 90 days after an answer", () => {
  const now = Date.UTC(2026, 10, 24), phone = at(UA.safari26), day = 86400e3;
  assert.equal(ASK_AGAIN, 90 * day);
  assert.equal(launchDue({ p: phone, isInstalled: false, asked: null, now }), true);
  assert.equal(launchDue({ p: phone, isInstalled: false, asked: now - day, now }), false);
  assert.equal(launchDue({ p: phone, isInstalled: false, asked: now - 89 * day, now }), false);
  assert.equal(launchDue({ p: phone, isInstalled: false, asked: now - 91 * day, now }), true);
  assert.equal(launchDue({ p: phone, isInstalled: true, asked: null, now }), false);
  assert.equal(launchDue({ p: at(UA.chromeWindows), isInstalled: false, asked: null, now }), false);
  // An in-app browser is a phone browser too: its sheet shows the way to a real browser.
  assert.equal(launchDue({ p: at(UA.facebookAndroid), isInstalled: false, asked: null, now }), true);
  // A value that is not a time counts as no answer.
  assert.equal(launchDue({ p: phone, isInstalled: false, asked: "x", now }), true);
});
