# Roadmap

The goal is one web app that does all that the iPhone app does. Then the
project has no dependency on an app store. `WEB-PARITY.md` compares the two
apps screen by screen. These items are open.

## Update requests while the app is closed

Done on the web on 2026-11-12, with no contact details on the server.

An update request contains a way to reach the person, and only the device
keeps that. So the device sends the request, and the server only says when:

1. The app keeps one filled update request for each open report in the
   device's storage.
2. The Worker cron, which reads each subscribed reports id for ticket
   alerts, finds a report that is due (7 days with no movement and no
   update request).
3. It pushes an "ask" to one device of that id, with a ticket that works one
   time for 15 minutes.
4. The service worker on the device sends the kept request with the ticket,
   and shows a notification. The ticket takes the place of the robot check.

`web/worker/asks.js` has the rules. This needs ticket alerts to be on. On an
iPhone, that needs the app on the Home Screen.

Open:

- No report was due when this shipped, so no request went to the city on
  this path yet. The browser test delivers a push to the service worker
  against a local server. Look at the first real one.
- A device that is off for more than 15 minutes misses the ask. The server
  asks again the next day.
- An id with no alerts gets requests only when the app is open.

## A web app with no server between it and the city

The iPhone app calls the city's API directly. A browser cannot do this,
because the API sends no CORS headers, and the signing key must not be in
public JavaScript. Thus the web app needs the Worker, and its limits count
for each IP address, not for each person.

Only the city or its vendor can remove this dependency, with one of these:

- an API key for this server only,
- CORS for the address of this app,
- a public interface, for example Open311.

The permission email to the city asks for these. Until then, the Worker
stays, and each person can operate a copy of it.

## Police reports

Done on the web on 2026-11-12: a Police report screen, above KC Streetcar on
the Services tab. It has 911 and the non-emergency number, the department's
conditions for an online report, its 13 report types (each one opens the
department's own form, in English or Spanish), and the way to a copy of a
report. The A to Z list finds a police report by its type. The facts are from
the department's pages, with the date of the read, in `web/public/js/police.js`.

The city's app links to the police report page through `www.kcpd.org`, and
the certificate of that host expired on 2026-10-17. The web app does not use
that link.

Open:

- The iPhone app still shows the city's link.
- The list of report types is a copy. `npm run check-sources` (in `web/`)
  reads the department's page again and says what changed. It does not run
  on a schedule yet.
- It is not known if the department's online system has an interface that
  accepts a report with the spot and the photo filled in. Until then the app
  opens the department's own form.

## Pay city bills and tickets

Done on the web on 2026-11-12: a Pay screen, from a card on the City tab.
It lists 12 payments by the paper that the person has (water bill, parking
ticket, court ticket, taxes, ambulance bill, permit fee and more). Each one
opens the payment page of the office that owns it. The app takes no card
numbers. The A to Z list finds a payment by its name, and the city's "Pay
Online" link opens this screen. The list is from the city's Pay Online page,
with the date of the read, in `web/public/js/pay.js`.

Open:

- The list is a copy. `npm run check-sources` (in `web/`) reads the city's
  page again and says what changed. That page refuses most automated reads;
  the script uses a real Chrome, which gets through.
- It is not known if an office has a public lookup for a balance or a due
  date. With one, the app can show "your water bill is due on" for the home
  address.

## What the city's app has that Switchboard does not

Compared on 2026-11-12 with the calls in the city's Android app (`API.md`)
and with its live menu. Switchboard shows all the menu links.

- **Rate a closed report** (`rai_report_rating`). Done on the web on
  2026-11-12: the screen of a resolved or closed report has five stars and an
  optional comment, and the report card asks for a rating for 30 days. The
  city's server took a 5-star rating that day and shows it in the report
  list. The city's own app has the rating screen and hides the button that
  opens it (`API.md` section 9). Open: it is not known if 311 staff read the
  ratings. Ask the city.
- **Remove a report from my list** (`delete_report_from_device`).
- **The city's notices** (`notification_history`): what the city sends to
  every phone, for example a holiday trash delay. Done on the web on
  2026-11-12: the Report tab shows each notice of the past 30 days above the
  trash day until the person hides it, and the City tab keeps the list. The
  list is the same for each device, so the server reads it one time in ten
  minutes for all people. Open: a notice sends no alert yet. The cron can
  push a new one to each device with alerts on.
- **Earlier reports of the same type on the location step**
  (`searchNearestIssue`). Done on the web on 2026-11-12, in another way: the
  form lists the open reports of the same type within 500 feet of the spot,
  from the public map call with one category. The city's call sends no
  position and answers for the full city.
- **Mark an update as read on the city's side** (`read_history_timeline`).

## When the web app replaces the iPhone app

- Move all TestFlight testers to the web app. The same reports id works in
  the two apps: on the iPhone, use Settings > My reports > Copy it, then
  paste the id in Settings > My reports on the web.
- Stop the `push/` Worker (iPhone alerts through APNs). This also gives the
  account one more cron trigger.
- Remove `ios/` from the repo, and the iPhone rows from `WEB-PARITY.md`.
