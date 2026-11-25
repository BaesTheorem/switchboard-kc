var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/utils.ts
var WIN_ERROR = "Window is not available and no user agent was provided.";
var getUA = () => {
  var _a, _b;
  if (typeof window !== "undefined") {
    const ua = ((_a = window == null ? void 0 : window.navigator) == null ? void 0 : _a.userAgent) || ((_b = window == null ? void 0 : window.navigator) == null ? void 0 : _b.vendor) || // @ts-ignore
    (window == null ? void 0 : window.opera);
    if (ua) return ua;
  }
  console.error(WIN_ERROR);
  return "";
};
var empty = {
  isInApp: false,
  appKey: void 0,
  appName: void 0,
  skipped: false
};
var getIsAppleDevice = (ua) => {
  return ua.match(/(iPhone|iPad|iPod|Macintosh)/) !== null;
};
var checkSkip = ({
  skip,
  appKey,
  ua
}) => {
  if (!skip || skip.length === 0) return false;
  const isApple = getIsAppleDevice(ua);
  return skip.some(
    ({ appKey: excludeAppKey, platform }) => appKey === excludeAppKey && (!platform || isApple && platform === "apple" || !isApple && platform === "android")
  );
};
var isSafariRegex = new RegExp(
  /Mozilla\/5\.0 \([^\)]+\) AppleWebKit\/[^\s]+ \(KHTML, like Gecko\) Version\/[^\s]+ (Mobile\/[^\s]+ )?Safari\/[^\s]+$/
);
var getIsSafariUA = (ua) => {
  return isSafariRegex.test(ua);
};
var isiOS = (ua) => {
  return [
    "iPad Simulator",
    "iPhone Simulator",
    "iPod Simulator",
    "iPad",
    "iPhone",
    "iPod"
  ].includes(ua) || // iPad on iOS 13 detection
  window && window.document && ua.includes("Mac") && "ontouchend" in window.document;
};
var getSafariVersion = (ua) => {
  const match = [...ua.matchAll(/Version\/([^\s]+)/g)];
  return match[0][1];
};
function waitForPageLoad() {
  return __async(this, null, function* () {
    return new Promise((resolve) => {
      if (window.document.readyState === "complete") {
        resolve(true);
      } else {
        const onLoad = () => {
          resolve(true);
          window.removeEventListener("load", onLoad);
        };
        window.addEventListener("load", onLoad);
      }
    });
  });
}
var pollForProperties = (_0) => __async(null, [_0], function* ({
  maxTime,
  properties,
  interval
}) {
  let elapsed = 0;
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      elapsed += interval;
      for (const property of properties) {
        if (property in window) {
          clearInterval(intervalId);
          resolve(true);
          return;
        }
      }
      if (elapsed >= maxTime) {
        clearInterval(intervalId);
        resolve(false);
      }
    }, interval);
  });
});

// src/detectTelegram.ts
var getIsTelegram = () => {
  return "TelegramWebview" in window || // Android
  "TelegramWebviewProxy" in window || // iPhone
  "TelegramWebviewProxyProto" in window;
};

// src/detectClientSide.ts
var appNameCustom = {
  telegram: {
    name: "Telegram"
  }
};
var getDetectClientSide = () => {
  if (typeof window === "undefined") return;
  if (getIsTelegram()) return "telegram";
  return;
};
var appKeysDetectByCustom = Object.keys(
  appNameCustom
);

// src/regexAppName.ts
var appNameRegExps = {
  messenger: {
    regex: /(\bFB[\w_]+\/(Messenger))|(^(?!.*\buseragents)(?!.*\bIABMV).*(FB_IAB|FBAN).*)/i,
    // Experimental for newer UAs - don't have `"useragents:" or end in "IABMV"
    name: "Facebook Messenger"
  },
  instagram: {
    regex: /\bInstagram/i,
    name: "Instagram"
  },
  facebook: {
    regex: /\bFB[\w_]+\/|\bFacebook/i,
    name: "Facebook"
  },
  twitter: {
    regex: /\bTwitter/i,
    name: "Twitter"
  },
  line: {
    regex: /\bLine\//i,
    name: "Line"
  },
  wechat: {
    regex: /\bMicroMessenger\//i,
    name: "WeChat"
  },
  threads: {
    regex: /\bBarcelona/i,
    name: "Threads"
  },
  tiktok: {
    regex: /musical_ly|Bytedance/i,
    name: "TikTok"
  },
  snapchat: {
    regex: /Snapchat/i,
    name: "Snapchat"
  },
  linkedin: {
    regex: /LinkedInApp/i,
    name: "LinkedIn"
  },
  gsa: {
    regex: /GSA/i,
    name: "Google Search App"
  },
  whatsapp: {
    regex: /\b(WAiOS|WA4A)\//i,
    name: "WhatsApp"
  },
  reddit: {
    regex: /\bReddit\//i,
    name: "Reddit"
  }
};
var appKeysDetectByUA = Object.keys(
  appNameRegExps
);
var getAppKey = (ua) => {
  return appKeysDetectByUA.find(
    (appName) => appNameRegExps[appName].regex.test(ua)
  );
};

// src/regexInApp.ts
var inAppRegExps = [
  "WebView",
  // Apple devices but not with "Safari/" following
  "(iPhone|iPod|iPad)(?!.*Safari/)",
  // Android webview
  "Android.*wv\\)"
];
var inappRegex = new RegExp(
  `${inAppRegExps.map((reg) => `(${reg})`).join("|")}`,
  "i"
);

// src/detectSafariPrivate.ts
var currentSafariTest = () => __async(null, null, function* () {
  try {
    yield navigator.storage.getDirectory();
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.toLowerCase().includes("unknown transient reason");
  }
});
var safari13to18Test = () => {
  let settled = false;
  return new Promise((resolve) => {
    const name = `idb${Math.random()}`;
    const openReq = indexedDB.open(name, 1);
    const finish = (isPrivate, db) => {
      if (settled) return;
      settled = true;
      if (db) db.close();
      indexedDB.deleteDatabase(name);
      resolve(isPrivate);
    };
    openReq.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const putReq = db.createObjectStore("t", { autoIncrement: true }).put(new Blob());
      putReq.onerror = (event) => {
        var _a;
        const req = event.target;
        const message = ((_a = req.error) == null ? void 0 : _a.message) || "";
        finish(message.includes("are not yet supported"), db);
      };
      putReq.onsuccess = () => finish(false, db);
    };
    openReq.onerror = () => finish(false);
    openReq.onsuccess = () => finish(false, openReq.result);
  });
};
var getIsSafariPrivate = () => __async(null, null, function* () {
  var _a;
  if (typeof navigator === "undefined") return false;
  if (((_a = navigator.storage) == null ? void 0 : _a.getDirectory) !== void 0) {
    return yield currentSafariTest();
  } else if (navigator.maxTouchPoints !== void 0) {
    return yield safari13to18Test();
  }
  return false;
});

// src/detectSFSVC.ts
var compare = (a, b) => {
  return a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" });
};
var consoleDebug = ({
  note,
  debug,
  last
}) => {
  if (debug) {
    console.log(
      note,
      "SchemaDataExtractor" in window || "MicrodataExtractor" in window ? "This is Safari" : last ? "Did not detect Safari - assuming SFSVC" : "Still checking if Safari",
      performance.now()
    );
  }
};
var minSafariVersion = "17";
var getSFSVCExperimental = (..._0) => __async(null, [..._0], function* ({
  debug = false,
  maxVersion,
  maxTime = 300
  // Max time to figure out if it is Safari (ie not SFSVC)
} = {}) {
  const ua = getUA();
  if (!ua) return false;
  if (!isiOS(ua)) return false;
  if (!getIsSafariUA(ua)) return false;
  if ("clearAppBadge" in ((window == null ? void 0 : window.navigator) || {})) return false;
  if (getIsTelegram()) return false;
  const version = getSafariVersion(ua);
  if (compare(version, minSafariVersion) < 0) return false;
  if (maxVersion !== void 0 && (compare(maxVersion, minSafariVersion) < 0 || compare(version, maxVersion) > 0))
    return false;
  if (compare(version, "26.4") >= 0) {
    return !("browser" in window) || !window.browser;
  }
  const isSafariPrivate = yield getIsSafariPrivate();
  if (isSafariPrivate) return false;
  yield waitForPageLoad();
  if (debug) consoleDebug({ note: "Page loaded", debug });
  const isSafari = yield pollForProperties({
    interval: 60,
    maxTime,
    properties: ["SchemaDataExtractor", "MicrodataExtractor"]
  });
  if (debug) consoleDebug({ note: "Extra polling done", debug, last: true });
  return !isSafari;
});

// src/index.ts
var InAppSpy = (options = {}) => {
  var _a, _b;
  const { skip, ua = "" } = options;
  const userAgent = ua || getUA();
  if (!userAgent)
    return __spreadProps(__spreadValues({}, empty), {
      ua: userAgent
    });
  const skipFn = (key) => checkSkip({ skip, appKey: key, ua: userAgent });
  const uaAppKey = getAppKey(userAgent);
  if (uaAppKey || userAgent.match(inappRegex) !== null) {
    if (skipFn(uaAppKey)) return __spreadProps(__spreadValues({}, empty), { ua: userAgent, skipped: true });
    return {
      isInApp: true,
      appKey: uaAppKey,
      appName: uaAppKey ? appNameRegExps[uaAppKey].name : void 0,
      ua: userAgent,
      skipped: false
    };
  }
  const clientAppKey = getDetectClientSide();
  if (clientAppKey) {
    if (skipFn(clientAppKey)) return __spreadProps(__spreadValues({}, empty), { ua: userAgent, skipped: true });
    return {
      isInApp: true,
      appKey: clientAppKey,
      appName: (_b = (_a = appNameCustom) == null ? void 0 : _a[clientAppKey]) == null ? void 0 : _b.name,
      ua: userAgent,
      skipped: false
    };
  }
  return __spreadProps(__spreadValues({}, empty), {
    ua: userAgent
  });
};
var SFSVCExperimental = getSFSVCExperimental;
var index_default = InAppSpy;
if (typeof window !== "undefined" && false) {
  window.InAppSpy = InAppSpy;
  window.SFSVCExperimental = SFSVCExperimental;
}
export {
  SFSVCExperimental,
  index_default as default
};
