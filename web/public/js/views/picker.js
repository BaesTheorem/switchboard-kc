// Full-screen map with a fixed center pin: drag the map under the pin, or
// search for an address. Ported from LocationPicker in ReportForm.swift; the
// address search (the city's own locator) is new on the web.

import { DOWNTOWN, current, lastKnown } from "../lib/geo.js";
import { bag, html, icon, on, render } from "../lib/html.js";
import { dispose, makeMap, zoomFor } from "../map.js";
import { address, locate, suggest } from "../place.js";

/** Opens the picker. Resolves to { lat, lng, street, city, state, zip } or null on cancel. */
export function pickLocation(start) {
  return new Promise((resolve) => {
    const off = bag();
    const el = document.createElement("div");
    el.className = "picker";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Set the location");
    render(el, html`
      <div class="top">
        <button class="icon-btn" type="button" data-x="cancel" aria-label="Cancel">${icon("close")}</button>
        <div class="field border round prefix small no-margin grow" style="background:var(--surface)">
          <i aria-hidden="true">search</i>
          <input id="pk-q" type="search" placeholder="Search an address" aria-label="Search an address" autocomplete="off" enterkeyhint="search">
        </div>
      </div>
      <div class="suggest" id="pk-s" hidden></div>
      <div class="map" id="pk-map" aria-label="Map. Move it to put the pin on the spot."><i class="pin" aria-hidden="true">location_on</i></div>
      <div class="panel stack s12">
        <p class="headline" id="pk-addr" aria-live="polite">Move the map to the spot</p>
        <div class="row">
          <button class="btn tonal" type="button" data-x="me">${icon("my_location")}<span>Me</span></button>
          <button class="btn grow" type="button" data-x="use">${icon("check")}<span>Use this spot</span></button>
        </div>
      </div>`);
    document.body.append(el);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const c = start || lastKnown() || DOWNTOWN;
    let m = null, center = c, lookup = 0;
    const addrEl = el.querySelector("#pk-addr");
    const done = (v) => {
      off.run();
      dispose(m);
      el.remove();
      document.body.style.overflow = prevOverflow;
      resolve(v);
    };

    const showAddress = async () => {
      const mine = ++lookup;
      addrEl.textContent = "Finding the address";
      const a = await address(center);
      if (mine === lookup) addrEl.textContent = a.street;
    };

    makeMap(el.querySelector("#pk-map"), { center: c, metersAcross: 250 }).then((mm) => {
      m = mm;
      m.map.on("moveend", () => {
        const ctr = m.map.getCenter();
        center = { lat: ctr.lat, lng: ctr.lng };
        clearTimeout(m.t);
        m.t = setTimeout(showAddress, 450);
      });
      showAddress();
    });

    let sugTimer;
    const box = el.querySelector("#pk-s");
    off(on(el, "input", "#pk-q", (e) => {
      clearTimeout(sugTimer);
      const q = e.target.value;
      sugTimer = setTimeout(async () => {
        const list = await suggest(q);
        box.hidden = !list.length;
        render(box, html`<div class="rows" role="listbox" aria-label="Addresses">${list.map((s, i) => html`
          <button class="item" type="button" role="option" data-s="${i}">${icon("location_on")}<span class="grow sub">${s.text}</span></button>`)}</div>`);
        box.list = list;
      }, 300);
    }));
    off(on(el, "click", "[data-s]", async (e, b) => {
      const s = box.list[Number(b.dataset.s)];
      box.hidden = true;
      el.querySelector("#pk-q").value = s.text;
      const p = await locate(s.text, s.magicKey);
      if (p && m) m.map.jumpTo({ center: [p.lng, p.lat], zoom: zoomFor(150) });
    }));
    off(on(el, "keydown", "#pk-q", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      box.hidden = true;
      const p = await locate(e.target.value);
      if (p && m) m.map.jumpTo({ center: [p.lng, p.lat], zoom: zoomFor(150) });
    }));
    off(on(el, "click", "[data-x]", async (e, b) => {
      const x = b.dataset.x;
      if (x === "cancel") done(null);
      if (x === "me") {
        const p = await current();
        if (p && m) m.map.easeTo({ center: [p.lng, p.lat], zoom: zoomFor(250) });
      }
      if (x === "use") {
        b.disabled = true;
        done(await address(center));
      }
    }));
    const esc = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", esc);
    off(() => document.removeEventListener("keydown", esc));
    el.querySelector("[data-x=use]").focus();
  });
}
