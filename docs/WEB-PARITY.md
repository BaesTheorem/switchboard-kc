# The web app and the iPhone app, screen by screen

Each row names an iPhone feature (the Swift file that has it) and what the
web app (`web/`) does. "Same" means the same rules and the same wording.
Checked on 2026-10-20 with the browser tests in `web/test/e2e`.

## Report tab

| iPhone (Swift) | Web | Notes |
| --- | --- | --- |
| Photo first: camera, library, "No photo" (ReportTab) | Same | The camera opens through the browser's file picker. |
| Photo GPS sets the location (Place.gps) | Same | Some browsers remove location data from a picked photo; then the device position is used. |
| Health and help card (HealthHelp) | Same | |
| Near you: trash day, leaf and brush zone, plowing (CivicData) | Same, less the water outage | The water outage host (maps.kcwater.info) stopped resolving in October 2026, so the iPhone check fails too. |
| Reports waiting to send, with Retry (ReportTab) | Same | A report the city refuses stays in the list with the reason and a Remove button. |
| Your open reports, newest first, top 5 (ReportTab) | Same | |

## Filing a report

| iPhone (Swift) | Web | Notes |
| --- | --- | --- |
| Sections, A to Z, search, KC Streetcar shortcut (ReportBrowse, Sections) | Same | |
| One page of details (ReportForm) | Same | |
| The city's questions by kind (QuestionField) | Same | Dates and times use the browser's pickers and start at now, as on the iPhone. A question's own `regex` is now checked. |
| Location card and map picker (LocationPicker) | Same, plus address search | The picker can search the city's address locator. |
| Nearest address (Apple geocoder) | Changed | The city's own locators (AddressPoints, then MyKCMO), then OpenStreetMap. The street text matches the city's records. |
| Nearest intersection (US Census TIGER) | Same | |
| Location line in the description, where-questions filled in | Same | |
| Duplicate check: warn, block (Store.checkDuplicate) | Same | |
| Public map switch on by default, send anonymously, contact (ReportForm) | Same | Contact is kept on the device only. |
| Offline queue (Store.enqueue) | Same | Kept in IndexedDB. |
| Report sent, report number, the city's reply (DoneView) | Same | Offers ticket alerts when the user has not chosen. |
| Draft kept while the app runs | Better | Kept in IndexedDB, so a reload (iOS can drop a web app while the camera is open) does not lose it. |

## Reports tab

| iPhone (Swift) | Web | Notes |
| --- | --- | --- |
| Map of my reports and public pins (ReportsTab) | Same | All public pins are drawn (WebGL), with no 250-pin cap. |
| Open, Closed, All; 1 year to 30 days; Everyone or Only mine | Same | |
| Pin card: details, Request update | Same | A tap selects the nearest pin within 16 px. |
| List: Yours above Nearby, by distance | Same | Nearby shows the 300 nearest. The list is the screen-reader view of the map. |
| Public report detail | Fixed | Uses `reported_issue_detail`. Since Tyler's October 2026 fix, `get_issue_detail_citizen` (which the iPhone app uses) answers "Report not available." for other people's reports. |
| My report detail and timeline, update requests merged (ReportDetailView) | Same | |
| Request updates: checklist, contact, 7-day rule (RequestUpdatesView) | Same | |
| Ask automatically (AutoUpdates) | Changed | Runs when the app opens, at most every 6 hours. A web app gets no background time. |

## City tab

| iPhone (Swift) | Web | Notes |
| --- | --- | --- |
| Phone numbers, more numbers, search (CityTab) | Same | A number with an extension dials it after a pause. |
| License offices with today's hours (LicenseOffices) | Same | The hours parser keeps the iPhone's rules, including its known gaps (see below). |
| Buses and streetcar from the RideKC schedule (Transit) | Same | The feed comes through the server (no CORS); parsing runs in a Web Worker. |
| Health and help, basic needs lists (HealthHelp, CivicData) | Same | A HUD counselor with "N/A" as a website gets no Website button. |
| City pages | Same | |

## Other

| iPhone (Swift) | Web | Notes |
| --- | --- | --- |
| KC Streetcar form (Streetcar) | Changed | A web page cannot attach a photo to a text or an email; "Share the photo" opens the share sheet instead. |
| Ticket alerts (Push, push/worker.js) | Same rules | Web Push from the web server's own cron. On iPhone, only for an app added to the Home Screen. |
| Settings: theme, API status, key update, reports id | Same, plus | Save the reports id as a file; install the app; the owner's invite tools. |
| Key repair from the APK (KeyRefresher, APIHealth) | Same | The browser reads the APK; the server tests and saves the key. |
| iCloud Keychain copy of the reports id | Missing | A web app has no Keychain. The id is in two browser stores; Settings asks people to keep a copy. |

## iPhone fixes found while porting

- `get_issue_detail_citizen` no longer opens other people's reports, so the
  iPhone app's "Full details" on a public pin fails. Use `reported_issue_detail`
  there.
- `strippingHTML` deletes `<br>`, which joins two words. The web keeps it as a
  line break.
- The license-hours parser misreads "Last Saturday 8:00-12:00, Monday - Friday
  8:00-4:00" (only Monday and Friday count) and "Monday & Friday" (read as a
  range). The closed-date check is a substring match, so on 1/1 an office that
  lists 11/1 shows as closed.
- A HUD counselor's "N/A" website becomes a link.
