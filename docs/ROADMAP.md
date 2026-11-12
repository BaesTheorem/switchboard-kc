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

Today the city's app has a menu link, "Make a Police Report", to a page of the
Kansas City Police Department. Switchboard shows the same link in Health &
Safety, and the police non-emergency number in the City tab.

Found on 2026-11-12: the link goes to `www.kcpd.org`, and the certificate of
that host expired on 2026-10-17. A browser shows a warning. The page now lives
at `kcpolice.org/crime/make-a-police-report-online/`.

The plan, in steps:

1. Send people to the `kcpolice.org` address, not to the address in the city's menu.
2. Make the police a line of its own. The police department is not a city
   department and not part of 311, so this follows the rule of the app: the
   report goes to the office that owns the problem.
3. On that screen: 911 first for an emergency, then the types of report that
   the department takes online (in plain words), the online report itself, the
   non-emergency number, and how to get a copy of a report.

Not known: the full list of report types (the page refuses automated reads,
so a person must read it), and if the department's online system has an
interface that accepts a report with the spot and the photo filled in. Until
then the app opens the department's own form.

## Pay city bills and tickets

Today the city's app has the menu links "Pay Online", "KC Water", "Municipal
Court" and "Compass KC". Switchboard shows the same links, but "Pay Online" is
only in "Everything, A to Z".

The plan: a "Pay" door in Services. It lists each payment by the paper that
the person has: a water bill, a court ticket, a parking ticket, a tax bill, a
permit fee. Each one opens the payment page of the office that owns it. The
app does not take card numbers and does not keep account numbers.

To do first: read the city's Pay Online page and record each payment and its
address. The page refused automated reads on 2026-11-12, so a person must
read it.

Not known: if an office has a public lookup for a balance or a due date. With
one, the app can show "your water bill is due on" for the home address.

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
- **Earlier reports of the same type as pins on the location step**
  (`searchNearestIssue`). Switchboard runs the city's duplicate check and shows
  nearby reports on the Reports tab.
- **Mark an update as read on the city's side** (`read_history_timeline`).

## When the web app replaces the iPhone app

- Move all TestFlight testers to the web app. The same reports id works in
  the two apps: on the iPhone, use Settings > My reports > Copy it, then
  paste the id in Settings > My reports on the web.
- Stop the `push/` Worker (iPhone alerts through APNs). This also gives the
  account one more cron trigger.
- Remove `ios/` from the repo, and the iPhone rows from `WEB-PARITY.md`.
