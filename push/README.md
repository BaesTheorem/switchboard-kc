# KC 311 push

A Cloudflare Worker that sends an iPhone push within about a minute when the
city changes one of that phone's 311 reports. The city sends pushes only to
its own app, and iOS gives this app background time only when iOS chooses,
so the Worker does the watching.

## How it works

1. The app sends its MyCivic device id and its APNs token to `POST /register`.
2. A cron runs every minute. For each device it reads "my reports" (one call).
3. When the status or `updated_on` of a report, or of an update request that
   names it, changes, the Worker reads the report's timeline and the
   timelines of its update requests, merged by time.
4. Each report with new entries gets one push. The first look at a device
   records what exists and sends nothing.

Update requests are never reported on their own. Their activity goes out
under the report they name.

## Data kept

Cloudflare KV holds, per device: the device id, the APNs token, the APNs
environment, and the keys (time and title) of timeline entries already sent.
It holds no report text, address, or contact data. `POST /unregister` with
the device id and the same token deletes the entry. APNs answers "gone" for
a dead token, and the Worker then deletes the device.

The device id is the credential, the same as in the city API: anyone with it
can read that phone's reports. The app sends it only to this Worker.

## Limits (Workers free plan)

- KV: 100,000 reads and 1,000 writes a day. Each run reads the device list
  plus one entry per device, so about 60 devices fit. Writes happen only on a
  change, a registration, or a run with an error.
- 50 subrequests per run. Each device uses 1, plus 1 for each changed report
  and each of its update requests.

## Deploy

    push/bin/deploy

It needs `push/.env` (gitignored) with `CF_ACCOUNT_ID`, `CF_API_TOKEN` (Workers
Scripts:Edit and Workers KV Storage:Edit), and `APNS_KEY_ID`. The APNs key is
read from `~/.appstoreconnect/private_keys/AuthKey_<APNS_KEY_ID>.p8`. The city
key comes from `ios/Config/civic-config.json`, as in `testflight.sh`. After
the city rotates its key, deploy again.

## Endpoints

- `POST /register` `{device_uid, token, env: "sandbox" | "production"}`
- `POST /unregister` `{device_uid, token}`
- `GET /health` device count, and the last run that sent a push or had an error.
  KV reads are cached at the edge for 60 s or more, so the count can lag.
- `POST /run` with `Authorization: Bearer $ADMIN_TOKEN` runs the cron pass now
  and returns its result. `ADMIN_TOKEN` is in `push/.env`.
