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

## When the web app replaces the iPhone app

- Move all TestFlight testers to the web app. The same reports id works in
  the two apps: on the iPhone, use Settings > My reports > Copy it, then
  paste the id in Settings > My reports on the web.
- Stop the `push/` Worker (iPhone alerts through APNs). This also gives the
  account one more cron trigger.
- Remove `ios/` from the repo, and the iPhone rows from `WEB-PARITY.md`.
