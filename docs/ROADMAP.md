# Roadmap

The goal is one web app that does all that the iPhone app does. Then the
project has no dependency on an app store. `WEB-PARITY.md` compares the two
apps screen by screen. These items are open.

## Update requests from the server

The iPhone app sends update requests for earlier reports in the background
(AutoUpdates). A web app gets no background time. Thus the web app sends them
only when it is open, at most one time in 6 hours.

The plan: the Worker cron reads each subscribed reports id one time each
minute for ticket alerts. It can also send the update requests that are due
(7 days after the report and 7 days after the last update request).

The open decision: an update request contains the contact details of the
person. Today only the device keeps them. To send update requests from the
server, the server must also keep them, for each person who sets this to on.
Before this work starts, select if that is permitted, and how long the server
keeps the details.

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
- The list of report types is a copy. Read the department's page again from
  time to time, or make a check that compares the two.
- It is not known if the department's online system has an interface that
  accepts a report with the spot and the photo filled in. Until then the app
  opens the department's own form.

## Pay city bills and tickets

Done on the web on 2026-11-12: a Pay screen, from a row on the Services tab.
It lists 12 payments by the paper that the person has (water bill, parking
ticket, court ticket, taxes, ambulance bill, permit fee and more). Each one
opens the payment page of the office that owns it. The app takes no card
numbers. The A to Z list finds a payment by its name, and the city's "Pay
Online" link opens this screen. The list is from the city's Pay Online page,
with the date of the read, in `web/public/js/pay.js`.

Open:

- The list is a copy. Read the city's page again from time to time. That
  page refuses most automated reads; a real Chrome gets through.
- It is not known if an office has a public lookup for a balance or a due
  date. With one, the app can show "your water bill is due on" for the home
  address.

## What the city's app has that Switchboard does not

Compared on 2026-11-12 with the calls in the city's Android app (`API.md`)
and with its live menu. Switchboard shows all the menu links.

- **Rate a closed report** (`rai_report_rating`): stars, a note and photos.
  The call is in the app's code. It is not confirmed that Kansas City uses it.
- **Remove a report from my list** (`delete_report_from_device`).
- **The city's own message inbox** (`register_device`, `notification_history`,
  `update_notification_status`): messages that the city sends to every phone.
  Switchboard sends its own alerts when a report changes, and it does not
  receive the city's messages.
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
