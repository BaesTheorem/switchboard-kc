// worker/notices.js: a city notice (HTML from notification_history) as plain
// text and links. The first row is the notice the city had on 2026-11-12.

import assert from "node:assert/strict";
import test from "node:test";
import { cleanNotice, cleanNotices, decode } from "../../worker/notices.js";

const LIVE = { id: "18566", title: "Veteran's Day Holiday Trash & Recycling Collection Delay",
  description: "<p>In observance of the Veteran&#39;s Day Holiday on Wednesday, November 11th, Trash &amp; Recycling Collection will be on a one-day delay the rest of the week. For more information, please visit <a href=\"http://www.kcmo.gov/trash\" target=\"_blank\" rel=\"noopener noreferrer\">HERE</a></p>",
  timestamp: 1794340847, is_read: 0 };

test("the live notice: text with no markup, the link apart, the time in ms", () => {
  assert.deepEqual(cleanNotice(LIVE), {
    id: "18566",
    title: "Veteran's Day Holiday Trash & Recycling Collection Delay",
    text: "In observance of the Veteran's Day Holiday on Wednesday, November 11th, Trash & Recycling Collection will be on a one-day delay the rest of the week. For more information, please visit HERE",
    links: [{ text: "HERE", url: "https://www.kcmo.gov/trash" }],
    at: 1794340847000,
  });
});

test("no markup from the city gets through", () => {
  const n = cleanNotice({ id: 7, title: "<b>Snow</b> <script>alert(1)</script>plan", timestamp: "1794340847",
    description: `<div onclick="x()">Line one<br>Line two</div><p>Para &lt;b&gt; &quot;q&quot; &#x41;&nbsp;B</p><script>steal()</script><style>p{}</style>
      <img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a> <a href='https://kcmo.gov/snow?a=1&amp;b=2'>Snow <i>map</i></a> <a href=https://kcmo.gov/snow?a=1&amp;b=2>again</a> <a href="mailto:x@example.org">mail</a>` });
  assert.equal(n.title, "Snow alert(1)plan");
  // "<b>" here is text that the city wrote as &lt;b&gt;. The page shows it as text.
  assert.equal(n.text, 'Line one\nLine two\nPara <b> "q" A B\n\nbad Snow map again mail');
  assert.ok(!/<|script|onerror|onclick/.test(JSON.stringify(n.links)));
  // Only web addresses, each one time, as https.
  assert.deepEqual(n.links, [{ text: "Snow map", url: "https://kcmo.gov/snow?a=1&b=2" }]);
  assert.equal(n.id, "7");
  assert.equal(n.at, 1794340847000);
});

test("decode leaves an unknown entity and drops a control character", () => {
  assert.equal(decode("&amp;&unknown;&#0;&#65;&#x1F600;"), "&&unknown;A😀");
});

test("the list: the past 30 days, newest first, and no row without an id or a title", () => {
  const now = 1794340847000 + 86400e3;
  const day = 86400;
  const rows = [
    { id: "1", title: "Old", description: "x", timestamp: 1794340847 - 31 * day },
    { id: "2", title: "Newer", description: "x", timestamp: 1794340847 },
    { id: "3", title: "Older", description: "x", timestamp: 1794340847 - 5 * day },
    { id: "", title: "No id", description: "x", timestamp: 1794340847 },
    { id: "5", title: "", description: "x", timestamp: 1794340847 },
  ];
  assert.deepEqual(cleanNotices(rows, now).map((n) => n.id), ["2", "3"]);
  assert.deepEqual(cleanNotices(null, now), []);
  assert.deepEqual(cleanNotices("<html>", now), []);
});
