// Every report type, page, and number in alphabetical order, with a search
// field and a letter per group. Ported from AllItemsView.

import { bag, html, on, render } from "../lib/html.js";
import { listen } from "../state.js";
import { allItems, directoryRows, wirePicks } from "./directory.js";

export default function view(main, _params, ctx) {
  const off = bag();
  let query = "";
  render(main, html`<div class="screen stack">
    <div class="field border round prefix small no-margin">
      <i aria-hidden="true">search</i>
      <input id="q" type="search" placeholder="Search" aria-label="Search everything" autocomplete="off" enterkeyhint="search">
    </div>
    <div id="rows"></div>
  </div>`);
  const paint = () => render(main.querySelector("#rows"), directoryRows(allItems(), query, ctx.tab));
  paint();
  off(on(main, "input", "#q", (e) => { query = e.target.value; paint(); }));
  off(wirePicks(main, ctx.tab, ctx.go), listen("catalog", paint));
  return off.run;
}
