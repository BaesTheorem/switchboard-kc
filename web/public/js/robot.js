// Cloudflare Turnstile, the robot check on filing. A token works once and
// for five minutes, so each send asks for a fresh one: a retry after an
// error, and a report that waited in the offline queue, both need their own.
// The widget shows itself only when Cloudflare wants the person to click.

import { S } from "./state.js";

let loading = null;
function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    // A script that cannot load means no connection: the form then saves the report to the offline queue.
    s.onerror = () => { loading = null; reject(Object.assign(new Error("The robot check did not load."), { offline: true })); };
    document.head.append(s);
  });
  return loading;
}

/** Loads the check early, so the first send does not wait for the script. */
export const warmRobotCheck = () => { if (S.config?.turnstile && !S.config?.admin) load().catch(() => {}); };

/**
 * A fresh token, or null when this server has no robot check or the owner
 * is signed in (the server skips the check for the owner token). `box` is where
 * the widget appears if it needs a click; without one, it floats at the bottom.
 */
export async function robotToken(box) {
  const sitekey = S.config?.turnstile;
  if (!sitekey || S.config?.admin) return null;
  const ts = await load();
  const own = !box;
  if (own) {
    box = document.createElement("div");
    box.style.cssText = "position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:50";
    document.body.append(box);
  }
  const holder = document.createElement("div");
  box.replaceChildren(holder);
  try {
    return await new Promise((resolve, reject) => {
      const id = ts.render(holder, {
        sitekey, appearance: "interaction-only", "refresh-expired": "never",
        callback: (t) => { resolve(t); ts.remove(id); },
        "error-callback": () => { reject(new Error("The robot check did not pass. Try again.")); ts.remove(id); },
        "timeout-callback": () => { reject(new Error("The robot check timed out. Try again.")); ts.remove(id); },
      });
    });
  } finally {
    if (own) box.remove(); else holder.remove();
  }
}
