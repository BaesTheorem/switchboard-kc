// Which device and browser the app runs in, read from the navigator. It
// answers one question for install.js: how does a person put this app on the
// Home Screen here? `platform` is a pure function of a navigator-like object,
// so test/unit/platform.test.mjs runs it against real user agent strings.
//
// The facts it rests on:
// - An iPad's Safari says "Macintosh". A Mac has no touch points; an iPad has 5.
// - Safari 26 and later keep "iPhone OS 18_6" in the user agent on every later
//   system, so the Safari version is only in "Version/NN" (WebKit blog,
//   "WebKit Features in Safari 26.0", Update to UA String).
// - On iPhone and iPad every browser is WebKit, and each has its own toolbar.
//   A browser app (Chrome, Firefox, Edge) has Add to Home Screen in its Share
//   menu since iOS 16.4. A web view inside another app (Facebook, Instagram,
//   LinkedIn) has none (WebKit blog, "Web Push for Web Apps on iOS and
//   iPadOS"). An Android web view has no install menu either. inapp-spy
//   finds both.

import InAppSpy from "../../vendor/inapp-spy/index.mjs";

// Safari's own user agent, from start to end. Chrome, Firefox, Edge and
// DuckDuckGo on iPhone add a name of their own (CriOS/, FxiOS/, EdgiOS/,
// DuckDuckGo/), so they do not fit it.
const SAFARI = /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/\S+ \(KHTML, like Gecko\) Version\/(\d+)\S* (?:Mobile\/\S+ )?Safari\/\S+$/;
// Android browsers that are not Chrome and have their own menus.
const ANDROID_OTHER = /(?:SamsungBrowser|EdgA|OPR|OPT|Firefox|DuckDuckGo|UCBrowser|YaBrowser|Vivaldi|MiuiBrowser|HuaweiBrowser|Silk)\//;
// The names a person knows these apps by.
const APP_NAMES = { Twitter: "X", "Facebook Messenger": "Messenger", "Google Search App": "The Google app" };

/**
 * The device and the browser.
 * - os: "ios" (iPhone and iPad), "android", or "other" (a computer).
 * - mobile: a phone or a tablet, where an app goes on the Home Screen.
 * - ipad: an iPad, or an iPhone that asks for the desktop site.
 * - browser: "safari", "chrome", "other" (a browser with its own menus), or
 *   "inapp" (a web view inside another app, which cannot install).
 * - version: Safari's major version on iPhone and iPad (26, 27), else 0.
 * - app: the name of the app around an in-app browser ("Instagram"), or "".
 */
export function platform(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || "");
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const android = !ios && /Android/.test(ua);
  const here = { os: "other", mobile: ios || android, ipad, browser: "other", version: 0, app: "" };
  if (ios) here.os = "ios";
  if (android) here.os = "android";
  if (!here.mobile) return here;

  const spy = InAppSpy({ ua });
  if (spy.isInApp || (ios && !/Safari\//.test(ua))) {
    here.browser = "inapp";
    here.app = APP_NAMES[spy.appName] || spy.appName || "";
    return here;
  }
  if (ios) {
    const safari = SAFARI.exec(ua);
    // Brave on iPhone sends Safari's user agent; it names itself in the navigator.
    if (safari && !nav?.brave) { here.browser = "safari"; here.version = Number(safari[1]); }
    else if (/CriOS\//.test(ua)) here.browser = "chrome";
    return here;
  }
  if (/Chrome\/\d/.test(ua) && !ANDROID_OTHER.test(ua)) here.browser = "chrome";
  return here;
}
