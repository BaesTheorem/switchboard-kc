# Roadmap

The goal is one web app that does everything the iPhone app does, so the
project needs no app store. `WEB-PARITY.md` compares the two apps screen by
screen. These items are still open.

## Update requests in the background

The iPhone app asks the city for updates on old reports in the background
(AutoUpdates). A web app gets no background time, so the web app asks only
when it is open, at most every 6 hours.

The plan: the Worker cron already reads each subscribed reports id every
minute for ticket alerts. It can also file the update requests that are due
(7 days after filing and 7 days after the last request).

The open decision: an update request carries the person's contact details.
Today only the device keeps them. To send requests from the server, the
server must keep them too, for the people who turn this on. Decide whether
that is acceptable, and how long the server keeps them, before building it.

## A web app with no server between it and the city

The iPhone app calls the city's API directly. A browser cannot, because the
API sends no CORS headers and its signing key cannot be in public
JavaScript. So the web app needs the Worker, and its limits count per IP
address, not per person.

Only the city or its vendor can remove this need: by a key of our own for
the server, by CORS for this app's address, or by a public interface such
as Open311. The permission request to the city asks for these. Until then,
the Worker stays, and anyone can run their own copy of it.

## When the web app replaces the iPhone app

- Move every TestFlight tester to the web app. The same reports id works in
  both: Settings > My reports > Copy it on the iPhone, then Restore on the web.
- Stop the `push/` Worker (iPhone alerts through APNs). This also frees a
  cron trigger on the account.
- Remove `ios/` from the repo, and the iPhone rows from `WEB-PARITY.md`.
