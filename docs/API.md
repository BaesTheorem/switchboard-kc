# MyCivic v3 API: KCMO 311 ("myKCMO") report endpoints

Source: jadx output of `com.civicapps.kansascitymo` (app code in
`src/sources/com/my/city/app/`, `BuildConfig.APP_VERSION = "2025.020"`).
Probe evidence: read-only signed calls made 2026-10-05.

Each section marks a statement as one of these:

- **[code]**: read directly from the decompiled Java.
- **[probe]**: confirmed by a live signed call.
- **[guess]**: an inference. Do not rely on it without a test.

---

## 1. Transport

### 1.1 Hosts

| Item | Value |
| --- | --- |
| Token / base URL | `POST https://api.mycivicapps.com/token/get_baseurl` |
| API base | `https://api.mycivicapps.com/api/v3/` (from `response_data.maindomainurl` + `/`) [probe] |
| Asset CDN | `https://prod-assets.mycivicapps.com/production/<city_id>/...` (photos, menu icons) [probe] |
| KCMO `city_id` | `1adb57d07d9ea1e1dd8160697f745c0d` [probe] |
| "Make a Report" `menu_id` | `10871` (menu row `menu_item_type = REPORTISSUE`) [probe] |
| "My Reports" `menu_id` | `9993` (`MYREPORT`) [probe] |

The base URL is stable. A client can hard-code it and call `get_baseurl` only
when the server returns `response_code: 403` (the app does exactly that, then
retries once) [code: `APIController.parseJsonObjectResponse`].

`get_baseurl` request: multipart, one part `POST_JSON` =
`{"city_id","api_version":"6.0","deviceuid","app_type":"CITY"}` (+ `session_key` if logged in).
Response [probe]:

```json
{"response_code":1,"response_token_message":"Success","response_data":{
  "city_id":"...","api_version":"6.0","deviceuid":"...","app_type":"CITY","version":"6.0",
  "maindomainurl":"https://api.mycivicapps.com/api/v3","cityhash_id":"...","session_key":"",
  "proxy_base_url":"https://api-njs.mycivicapps.com/"}}
```

### 1.2 Request encoding

- Every call is `POST` with `Content-Type: multipart/form-data` (Retrofit `@Multipart` + `@PartMap`) [code].
- Each field is a separate form part with no filename. The app labels each part
  `Content-Type: multipart/form-data` (some `POST_JSON` parts use `text/plain`).
  The server does not care about the per-part content type [probe: both work].
- Two field styles exist. Each endpoint below says which one it uses:
  - **Flat parts**: one part per field.
  - **POST_JSON**: one part named `POST_JSON` whose value is a JSON object string.
- A small number of endpoints take one JSON-string part with a different name
  (`issue_details`, `rating_details`, `FilterOptions`).
- **Files**: at most one file part per request. Its name is `file_zip`, filename
  `<epoch_ms>_images.zip`, part content type `multipart/form-data`. It is a ZIP of
  JPEGs, never a bare image (section 3.6) [code: `APIController.postZipFile`].
- `APIController.createRequest()` adds **no** default fields. Every field comes from
  the caller [code].
- The app sends `User-Agent: okhttp/<ver>`. The server did not reject a Python UA in tests,
  but the probes used `okhttp/4.9.0` [probe].

### 1.3 The `ApiSignature` header (required on every call)

An HS256 JWT built by `WebServiceController.createJWTPayload`, added by an OkHttp
network interceptor to every request, including `get_baseurl` [code].

- Header: `{"alg":"HS256"}` (jjwt default, no `typ`).
- Claims (all strings):

| Claim | Value |
| --- | --- |
| `city_id` | the city hash (`"PREVIEW"` if unset) |
| `deviceuid` | the device id (section 1.4) |
| `APPTYPE` | `"CITY"` |
| `app_version` | `"2025.020"` |
| `device_type` | `"android"` |
| `APIVERSION` | `"6.0"` |
| `nounce` | 12 random chars from `[a-zA-Z0-9]` (sic, "nounce") |

- No `iat` / `exp`. A fresh `nounce` per request is what the app does. Replay was not tested.
- Key: the 44-character string constant `WebServiceController.KEY` (the app reads it from the APK at run time),
  used as its **raw ASCII bytes** (`KEY.getBytes()`), not base64-decoded. Keep it out of
  any public repo.
- Signature: standard JWS compact form, base64url without padding.

Server behavior [probe, `myissues`]:

| Header | Result (HTTP is always 200) |
| --- | --- |
| absent | `{"response_code":403,"response_token_message":"Invalid request : "}` |
| bad signature | `{"response_code":1,"response_token_message":"Deprecated request or Invalid API Signature, kindly update the app to latest version"}` |
| valid | normal response |

Caution: a bad signature returns `response_code: 1`, which is the success code for
some endpoints. Always check for `response_token_message` first.

### 1.4 Device identity (`deviceuid` / `device_id`)

- `Constants.android_DeviceId = Settings.Secure.getString(cr, "android_id")` [code: `UILApplication.onCreate`].
  On Android 8+ this is 16 lowercase hex chars, unique per app signing key, user and device.
- The same value goes into the JWT `deviceuid` claim and into the `device_id` and
  `deviceuid` body fields.
- The server accepted arbitrary strings (`probe-0001`, `3f9c2a7b5e1d4c08`) without
  a prior `register_device` [probe]. For a client, generate 16 random hex chars
  once and persist them. **This value is the only key to "my reports"** (section 4).
- `register_device` is not required for any read endpoint [probe]. It is not known
  whether `report_an_issue` needs it [guess: no, the server creates device rows on demand,
  but this is not tested].

### 1.5 Response envelope

There are two envelope styles, and the success code differs by endpoint:

- **Top level**: `{"response_code", "response_message", "response_data", ...}`
  (`get_main`, `get_issue_detail_citizen`, `reported_issue_detail`, `check_duplicate_issue`,
  `read_history_timeline`, `add_comments_citizen`).
- **Wrapped**: `{"response_status": {"response_code", "response_message", "response_data", ...}}`
  (`report_an_issue`, `rai_report_rating`, `searchNearestIssue`, `reported_issues_list`, `reported_issues_map`).
- **No envelope**: `myissues` returns its fields at top level with no `response_code`.

Success codes: see each endpoint. `0` means success for list/detail/duplicate-check endpoints,
`1` means success for submit/nearest endpoints. `401` means invalid session, `403` means
a base URL or token problem, `201` means a token error with `response_token_message` [code].

---

## 2. Login: not needed for KCMO

- KCMO `city_info`: `login_type = 0`, `enable_web_login = "no"`, `user_profile = "no"`,
  `user_info_required = "no"`. Every menu has `enable_login = "no"`, and every category and
  subcategory has `login_required = "no"` [probe: `get_main.json`].
- `login_type 0` is the "default login type". The app shows a local dialog for first name,
  last name, email and phone, and stores the result on the device only
  (`AppPreference.saveUserInfoForDefaultLoginType`). It never calls `user_login` or
  `create_session` [code].
- Thus `sessionkey` / `session_key` is absent from every KCMO request.
  Every endpoint in this file works with no session [probe for reads, code for writes].
- For other cities: `user_login` takes `POST_JSON {username, password, city_id, device_id,
  api_version}` and returns `user_data` + `session_data.session_id`. The app then sends
  `session_data.session_id` as `sessionkey` (as `session_key` in `check_duplicate_issue` and `get_baseurl`).
  `create_session` takes `POST_JSON {city_id, device_id, user_id, access_token, expire_in,
  refresh_token, api_version}` after a web (OAuth) login [code]. Not used in KCMO.

---

## 3. `report_an_issue` (submit a report). WRITES A REAL CITY RECORD

Not called during this work. Everything here comes from code.

### 3.1 HTTP shape

`POST {base}report_an_issue`, multipart [code: `RaiAddNotes_Fr.call_SubmitAPI`]:

| Part | Content |
| --- | --- |
| `issue_details` | JSON object string (section 3.2) |
| `file_zip` | optional ZIP of photos (section 3.6). The app attaches it only when photos exist. |

No other parts. Note: `city_id`, `device_id` and other fields are **inside** `issue_details`,
not separate parts.

### 3.2 `issue_details` fields

Built in `RaiAddNotes_Fr.callSubmit()`. "Always" means the app always sends the key.

| Key | Always | Value / source |
| --- | --- | --- |
| `city_id` | yes | city hash |
| `menu_id` | yes | `"10871"` |
| `timestamp` | yes | `System.currentTimeMillis()` as a string (ms) |
| `deviceuid` | yes | device id |
| `device_id` | yes | device id |
| `first_name`, `last_name`, `email`, `phone` | no | locally stored contact info. Omitted when the user taps "stay anonymous" (`Constants.isReportIssueAnonymously`) or when no contact info exists. **The anonymous flag is just the absence of these four keys.** There is no `anonymous` field. |
| `type` | yes | the effective category type: the first selected subcategory's `type` if non-empty, else the category's `type`. Values seen: `"Standard"`, `"form_type"`, `"form_type_car"`, `"Light Pole Issue Report"`, `"Abandoned Vehicle Report"` [code: `SubCategory_Fr.getRAICategoryType`] |
| `type_id` | yes | category `cat_id` (for example `"53842"`) |
| `name` | yes | category `name` (for example `"A Pothole"`) |
| `issue_cat_id` | yes | category `server_id` (equal to `cat_id` for every KCMO row) |
| `subtype` | yes | subcategory **name(s)**, joined with `|` when there are more than one (for example `"Pothole in the Street"`). `""` if the category has no subcategories. |
| `SELECTED_SUB_TYPE` | yes | JSON array, one object per selected subcategory (section 3.3). `[]` if none. |
| `location` | if location set | the street address text. The code sends `"lat,lng"` only when a radio flag is true, but `RaiLocation_Fr.radioChecked` is always 2, so in practice this is always the address text [code] |
| `address` | if location set | street text, plus `", " + cross street` if a cross street exists (the cross street is always `""` in this build) |
| `RAI_STREET`, `RAI_CITY`, `RAI_STATE`, `RAI_ZIP` | if location set | address parts from the location screen (geocoder or user typed) |
| `addressline1`, `addressline2`, `unit`, `magic_key` | no | from the geocoder result, only when present. `magic_key` is an Esri-style suggestion key (`map_thirdparty_type = 101`) [guess] |
| `notes` | yes | the description text (may be `""`) |
| `form_data` | only if type is `form_type` or `form_type_car` | object `{caption: answer}` (section 3.4) |
| `new_form_data` | same condition | array `[{"caption","type","sort_order","enterdValue"}]` (sic `enterdValue`) |
| `car_info` | `Abandoned Vehicle Report` and `form_type_car` | array `[{"plate_number","make","model","color"}]`. Only present if at least one vehicle was entered. Choices come from the `CAR_DETAIL` table in `get_main`. |
| `light_pole_info` | `Light Pole Issue Report` | `{"pole_number": "..."}` |
| `inspection_info`, `crimeInfo`, `commendOfficer` | other types | not used by any KCMO category |
| `RAI_LAT` | yes | pin latitude as a JSON number, or `""` if 0 |
| `RAI_LONG` | yes | pin longitude as a JSON number, or `""` if 0 |
| `share_options` | yes | `"public"` or `"private"` (section 3.5) |
| `files_metadata` | yes | `[{"filename":"CAM<ms>.jpeg","metadata":{"creation_date":"yyyy-MM-dd hh:mm:ss"}}]`, one per photo, `[]` if none. Note `hh` is the 12-hour clock with no AM/PM (an app bug). |
| `api_version` | yes | `"6.0"` |
| `report_contact_info` | no | `{"firstName","lastName","email","phoneNumber"}`. Only for `thirdparty_type == "13"`, which KCMO does not use. |
| `offline_timestamp` | yes | GMT epoch ms (number). Added just before send. |
| `sessionkey` | no | only for logged-in cities |

Validation the app does before submit [code]:

- **Location**: if `location_required` is `"yes"` (resolved from the subcategory first, then
  the category), the user must give a pin or a street. Light Pole types always require a location.
- **Photos**: required only if `attachment_required = "yes"`. It is `"no"` on every KCMO row.
- **Form answers**: required answers must be non-empty. An optional `regex` must match
  (section 7.3).
- **Notes**: required only for menus with `navigation_type = "AAQ"` (not KCMO).
- `description_required`, `mandatory_contact_info` and `no_entry` are parsed from `get_main`
  but **never enforced** in this Android build. The server can still enforce them. One KCMO
  category ("Tents or Sleeping Structures") has `description_required = "yes"`, so send
  `notes` for it.

### 3.3 `SELECTED_SUB_TYPE` element (`RaiSubcategory.toJSONObject`)

```json
{"Id": "<local sqlite row id>", "category_id": "53842", "subCat_id": "44019",
 "name": "Pothole in the Street", "image": "", "cat_order": "2", "type": "form_type",
 "menu_id": "10871", "server_id": "44019", "autoresponse_text": "...",
 "share_options": "", "sort_order": "", "login_required": "no",
 "disclaimer_phone": "", "disclaimer_text": "...", "disclaimer_title": "...",
 "disclaimer_url": "", "enable_disclaimer": "yes", "disclosure": "",
 "form_data": "<the subcategory's form_data string>", "contact_info_required": "no",
 "thirdparty_type": "17", "thirdparty_id": "Streets / Roadways / Alleys-Pothole"}
```

Map from the `get_main` subcategory record: `subCat_id` = `subcat_id`, `server_id` = `server_id`,
`category_id` = `category_id`, and the other keys copy across by the same name.
`Id` is a local database row id that is not in `get_main`. Send `""` or the
subcategory id [guess: the server uses `subCat_id`/`server_id`]. `share_options` /
`sort_order` / `image` / `disclosure` are not in KCMO subcategory rows, so send `""`.
It is not known which keys the server reads. Sending the full object is the safe choice.

Multiple subcategories: allowed only when the category has `allow_multiple_subtypes = "yes"`
(Animal Services, Discrimination Report, Tents, Snow). Form fields then come from the
**first** selected subcategory.

### 3.4 Custom question answers (`form_data`, `new_form_data`)

The question schema comes from the first selected subcategory's `form_data` if that string
is non-empty and the subcategory `type` is non-empty. Otherwise it comes from the category's
`form_data` [code: `RaiFormDetail_Fr.setData`]. Sort the questions by `sort_order`.

Answer encoding per field `type` [code: `RAI_FormDataAdapter`, `RaiAddNotes_Fr.getFormDataJSON`]:

| type | UI | Answer string sent |
| --- | --- | --- |
| 1 | Yes/No radio | `"YES"` or `"NO"`. An untouched radio sends `"N0"` (zero, an app bug). Send `"NO"`. |
| 2 | month/year text with mask | `"MM/yyyy"`. An empty mask `"--/----"` counts as empty. |
| 3 | free text | the text |
| 4 | dropdown (`dropdown_options`) | the chosen option **`id`** values, joined with `,` and no spaces. The display text is not sent. `allow_multiple_select = "yes"` permits more than one. |
| 5 | date + time picker | `"MM-dd-yyyy HH:mm"` |
| 6 | date picker | `"MM-dd-yyyy"` |
| 7 | time picker | `"HH:mm"` |

(Type 7 is in the app but no KCMO record uses it. Type 2 is also unused in KCMO.)

```json
"form_data": {"Number of Potholes": "Multiple potholes"},
"new_form_data": [{"caption": "Number of Potholes", "type": 4, "sort_order": 1,
                   "enterdValue": "Multiple potholes"}]
```

The key in `form_data` is the question `caption`. Two questions with the same caption
would collide (an app limitation).

The detail response returns answers as
`form_data: [{"report_id","json_string":"[{\"title\":caption,\"value\":answer,\"type\":\"4\"}]"}]` [probe].

### 3.5 `share_options`

The app shows a public/private switch only when the menu has `enable_all_issues = "yes"`
and the category id is in the `filtered_issue_type_ids` from the last `reported_issues_list`
call. Otherwise it is hidden. Default: `"private"` when the city `default_share_options` is
`PRIVATE` and the switch is hidden, else `"public"` [code: `RaiAddNotes_Fr.setDefaultShareOptionValue`].
KCMO `default_share_options = "PRIVATE"`.

Warning: the effect of `private` is not verified. Before a server fix in October 2026,
`get_issue_detail_citizen` returned the reporter's name, email and phone for a public report
to an unrelated anonymous device (section 5). Do not assume that `private` hides contact info.

### 3.6 Photos

- One ZIP file, part name `file_zip`, filename `<epoch_ms>_images.zip` [code].
- ZIP entries: one per photo, named `CAM<epoch_ms>.jpeg` (`.png` for PNG). The image is
  re-encoded and scaled to fit 1000x1000 (`ImageUtils.compressImage`) [code].
- Each entry name must match a `files_metadata[].filename` in `issue_details` [guess: the server
  pairs them].
- Every category allows uploads (`allow_image_uploads = "yes"`).
- Server-side names look like `<id>_<n>.jpeg` under
  `.../<city_id>/report_an_issue/` [probe: `issue_image` URLs].

### 3.7 Response

`RaiAddNotes_Fr.parseReportAnIssueAPIControllerResponse` reads only these fields:

```json
{"response_status": {"response_code": 1, "response_message": "...", "work_order": "376xxx"}}
```

- `response_code == 1`: success. The app shows "Report submitted #<work_order>", then the
  autoresponse text (subcategory `autoresponse_text` if set, else the category's).
  `work_order` is presumably the KC case number (same series as `display_wo` / `thirdparty_params.case_number`) [guess].
- `response_code == 0`: failure. Show `response_message`.
- The app does not read the new report's MyCivic id from this response. To get it,
  call `myissues` afterward. The new report must appear there for this `deviceuid`.

### 3.8 Recommended submit sequence (from the app's flow)

1. Pick a category from `RAI_CATEGORY`. If `enable_disclaimer = "yes"`, show
   `disclaimer_title` / `disclaimer_text`. A `disclaimer_phone` or `disclaimer_url` means
   "call or open this link instead" (the app offers that as the action).
2. Pick subcategories from `RAI_SUBCATEGORY` where `category_id` = category `cat_id`,
   sorted by `cat_order`.
3. If the effective type is `form_type` or `form_type_car`, ask the `form_data` questions.
4. Set the location. If `prevent_duplicate_issue > 0` on the category or any chosen
   subcategory, call `check_duplicate_issue` (section 6.2) and obey `allow_duplicate`.
5. Write notes, add photos, then choose contact info or anonymous.
6. POST `report_an_issue`.

---

## 4. `myissues` (my reports)

`POST {base}myissues`, one part `POST_JSON` [code: `GetRAIMyReportListingAPIController.createRequest`]:

```json
{"city_id":"<city>","deviceuid":"<dev>","device_id":"<dev>","start":0,"api_version":"6.0"}
```

(+ `sessionkey` if logged in.) `start` is a 0-based offset, and `per_page` is 20.

**"Mine" means the reports submitted with this `deviceuid`/`device_id`.** There is no
email lookup and no account. A new device id has an empty list. Losing the id loses the list.
The JWT `deviceuid` claim and the body fields must agree [guess: the server can use either].

Response (no envelope) [probe, empty for a fresh device]:

```json
{"timestamp":1791232365,"has_more":0,"per_page":20,"total_record":"0","start":0,"my_issues":[]}
```

`my_issues[]` element fields the app reads [code: `ResponseParser.parseReport_Response`].
These were not observed live, because no report exists for the probe device:

| Field | Definition |
| --- | --- |
| `id` | MyCivic report id. Pass it as `issue_id` to `get_issue_detail_citizen`. |
| `city_report_id` | the id used by `delete_report_from_device` and `rai_report_rating` (`report_id`) |
| `issue_type`, `category`, `subcategory` | names |
| `description`, `status`, `statuscolorcode` | `"r,g,b"` |
| `url` | |
| `thirdparty` | `"yes"`/`"no"` |
| `added_on`, `updated_timestamp`, `last_action_date` | epoch seconds (strings) |
| `last_visited_timestamp`, `new_update_count` | unread badge |
| `display_wo` | the work order / case number to show |

`has_more` is `"0"`/`0` when the list is at the end.

---

## 5. Report detail and timeline

### 5.1 `get_issue_detail_citizen` (detail of my report)

`POST {base}get_issue_detail_citizen`, flat parts [code: `FetchRAIReportDetailAPIController`]:
`city_id`, `api_version=6.0`, `device_id`, `deviceuid`, `issue_id` (+ `sessionkey`).

Response [probe, PII redacted]:
`{"response_code":0,"response_message":"Success","timestamp":"...","response_data":{"issues":[{...}]}}`.
The app takes `issues[0]`, and requires `details` to be non-null for its own success path.
An empty `issues` array means "You have been denied permission to access this issue".

`issue_id` is the MyCivic id: `report_id` in list/map, `mycivic_id` in `searchNearestIssue`,
`id` in `myissues`. It is not the 6-digit case number.

Issue object fields (union of probe and `ResponseParser.parseIssues_Object`):

| Field | Definition |
| --- | --- |
| `id`, `number` | MyCivic id |
| `display_wo` | KC case number (for example `"376006"`) |
| `status`, `actual_status`, `list_status`, `detail_status`, `statuscolorcode` | status of the issue |
| `default_status` | `"new|received|assigned|referred|resolved|canceled"` |
| `new_status[]` | `{name,image,type,color,sort_order,StatusBGcolorCode,StatusFontColorCode}`, the status timeline legend |
| `type`, `issue_type_id`, `rai_issue_type`, `subtype`, `sub_type` | category name, cat_id, category type, subcategory name |
| `description` | |
| `address`, `latitude`, `longitude` | lat/lng are strings |
| `timestamp`, `added_on` | epoch seconds (numbers here, strings elsewhere) |
| `department_id`, `bridge_id` | `"<dept>_<cat_id>_<subcat_id>"` |
| `header` | status blurb |
| `history_url` | staff history page (`/staffapi/staff_report_history/<id>`). The parser also reads the misspelled `histpry_url`. |
| `history_object[]` | `{title, details, staff_name, dateofupdate "MM/dd/yyyy hh:mm AM", timestamp, share_citizen, open_url_in_external, staff_upload ";"-separated URLs, sort_order, show_share_icon, city_name}` |
| `issue_image[]` | full photo URLs |
| `form_data[]` | see section 3.4 |
| `issue_action[]`, `issue_resolution[]` | `{title, description}` |
| `citizen_allow_to_send_note` | 1/0, gates the comment box |
| `hide_add_photos`, `display_incident_descriptions`, `display_incident_attachments` | |
| `reporter_firstname`, `reporter_lastname`, `reporter_email`, `reporter_phone` | **see the warning below** |
| `cross_street`, `light_pole_number`, `plate`, `make`, `model`, `color`, `car_details[]`, `inspection_time`, `permit_no`, `permit_type`, `inspection_code`, `commend_info[]`, `crime_info{}`, `assingedWorker[]`, `assingedSupportWorker[]`, `isSupportWorker` | type-specific fields |
| `last_visited_timestamp`, `new_update_count` | **side effect**: a detail call by this device sets `last_visited_timestamp` [probe: the second call returned the time of the first] |

**Privacy finding, fixed [probe]:** in October 2026, for a public report taken from
`reported_issues_list`, `get_issue_detail_citizen` (and `reported_issue_detail`) returned the
reporter's full name, email and phone to an anonymous, unrelated probe device. This was
reported to Tyler Technologies (TYLSECOPS-7328), and Tyler fixed it. A probe on 2026-10-20
showed the new behavior: `get_issue_detail_citizen` answers `Report not available.` for a
report that another device filed, and `reported_issue_detail` returns the `reporter_*` keys
empty. A client must still not log, cache or display these fields for other people's reports.

### 5.2 `reported_issue_detail` (detail of a public report)

Same request and response shape as 5.1 (`FetchReportedIssueDetailAPIController`, flat parts
`city_id`, `api_version`, `device_id`, `deviceuid`, `issue_id`). The app uses it from the
public list (`RaiListingDetailFragment`) [code]. The probe output is identical to 5.1 [probe].

### 5.3 `read_history_timeline` (mark updates read)

`POST {base}read_history_timeline`, flat parts: `issue_id`, `city_id`, `device_id`,
`api_version=6.0` (+ `sessionkey`) [code: `RAIReportDetailActivity.markNotificationAsRead`].

Response: `{"response_code":0,"response_message":"Success"}` [probe]. It returns no data.
Its only purpose is to clear the unread badge (`new_update_count`). It is a small write
(a read marker). The timeline data itself comes from `history_object` in the detail response.

---

## 6. Nearby and public reports

### 6.1 `searchNearestIssue` (existing reports of one category, for the map pins on the location screen)

`POST {base}searchNearestIssue`, flat parts [code: `GetSearchNearestIssueAPIController.createRequest`]:
`city_id`, `api_version=6.0`, `menu_id`, `device_id`, `issue_type_id` (= category `server_id`)
(+ `sessionkey`).

**No latitude or longitude is sent.** The server returns city-wide reports of that category
from approximately the last 90 days, without status or distance filters (258 potholes and
81 streetlights in the probes) [probe]. The app calls it only when the category has
`enable_duplicate_issues = "yes"`.

Response: `{"response_status":{"response_code":1,"response_message":"Report listing","response_data":[...]}}`.
Element [probe]:

| Field | Definition |
| --- | --- |
| `id` | the **case number** (equals `thirdparty_params.case_number`) |
| `mycivic_id` | MyCivic id. Use it for the detail calls. |
| `issue_name`, `sub_type` | category / subcategory name |
| `issue_description` | |
| `issue_status`, `mystatus`, `actual_status`, `issue_status_colorcode` | |
| `issue_image[]` | |
| `added_on`, `updated_on`, `issue_submitted_date` | epoch seconds (strings) |
| `report_date` | `"yyyy-MM-dd HH:mm:ss"`, UTC [guess from the offset] |
| `address`, `issue_address`, `latitude`, `longitude` | |
| `allow_open_detail` | `"1"` lets the app open the detail screen. It was `"0"` on all 258 rows. |
| `bridge_id`, `thirdparty_id`, `thirdparty_type`, `thirdparty_params`, `thirdparty_call_timestamp`, `cityhash_id`, `menu_id` | |

### 6.2 `check_duplicate_issue`

`POST {base}check_duplicate_issue`, one part `POST_JSON` [code: `CheckDuplicateIssueAPIController`]:

```json
{"latitude":"39.0937","longitude":"-94.5340","address":"4131 E Truman Rd","city":"Kansas City",
 "state":"MO","zip":"64127","type":"<cat_id>","subtype":"<subcat_id>[,<subcat_id>...]",
 "city_id":"<city>","device_id":"<dev>","api_version":"6.0"}
```

Note: in this call `type`/`subtype` are **ids** (subcategory ids comma-joined). In
`report_an_issue` they are a type string and names.

Response [probe, positive control at the location of an open pothole]:

| `allow_duplicate` | `response_code` | Definition | App behavior |
| --- | --- | --- | --- |
| `"0"` | 0 | no duplicate | submit |
| `"1"` | 1 | same category at this address (warn) | dialog with `response_message`, Cancel / Submit |
| `"2"` | 1 | same category + subcategory at this address, blocked | dialog with `response_message`, Cancel only |

```json
{"response_code":1,"response_message":"An issue has already been submitted of the same type and subtype at this address and cannot be submitted again.","response_data":{"allow_duplicate":"2","message_title":""}}
```

The match is by address and type, not only by distance [guess from the message text].
`prevent_duplicate_issue` on the record (`0` / `1` / `2`) predicts which result the server can give.

### 6.3 `reported_issues_list` (public list) and `reported_issues_map` (public map)

Both use flat parts [code: `RaiListing.call_getReportedIssue`, `callGetReportedIssueMapAPI`]:

| Part | list | map | Definition |
| --- | --- | --- | --- |
| `api_version` | yes | yes | `"6.0"` |
| `device_id` | yes | yes | |
| `city_id` | yes | yes | |
| `menu_id` | yes | yes | `"10871"` |
| `index` | yes | no | 0-based offset |
| `limit` | yes | no | the app uses 50 |
| `lat`, `lng` | no | yes | map center |
| `FilterOptions` | yes | yes | JSON string `{"status": "all"|"open"|"closed"|csv, "issue_type": "<csv of category names>"}` |

`issue_type` **must be non-empty**. An empty string or a missing `FilterOptions` causes
HTTP 500 with an empty body [probe]. The value is category **names**, comma-joined (for example
`"Streetlights,Graffiti"`). For "all types", send every name from `filtered_issue_type_ids`.

Response [probe]:

```json
{"response_status":{"response_code":0,"response_message":"Success","total_records":13139,
  "index":"0","limit":"5","has_more":"yes","status":{"open":"open","closed":"closed"},
  "status_color":{"open":"#4CC417","closed":"#FF0000"},
  "filtered_issue_type_ids":"11062|11064|...","response_data":[...]}}
```

- Success is `response_code == 0`.
- `filtered_issue_type_ids` (pipe-separated `cat_id`s) is the set of categories that are
  publicly listable.
- The map returns at most 1000 rows near `lat`/`lng` (all within 12.3 km of downtown in
  the probe), `has_more: "yes"`. Ordering by distance is not confirmed.

Element:

| Field | Definition |
| --- | --- |
| `report_id` | MyCivic id |
| `issue_type` | category type, for example `"form_type"` |
| `issue_type_id`, `issue_name`, `subtype` | |
| `issue_description`, `issue_image[]` | |
| `issue_status`, `mystatus`, `actual_status`, `issue_status_colorcode` | |
| `issue_submitted_date`, `issue_lastupdated_date` | epoch seconds, **numbers** |
| `issue_latitude`, `issue_longitude` | **numbers** |
| `issue_address` | |
| `color`, `cityhash_id`, `thirdparty_id`, `thirdparty_type`, `thirdparty_params` | `thirdparty_params` holds `case_number` |
| `thirdparty_call_timestamp`, `display_incident_descriptions`, `display_incident_attachments` | |

---

## 7. `get_main`: category and subcategory schema

`POST {base}get_main`, flat parts: `city_id`, `api_version=6.0`, `device_id`, `deviceuid`,
`timestamp` (last DB timestamp, `0` for a full dump), `app_type=1`, `language=en` (+ `sessionkey`).
Works anonymously [probe]. Response: `response_status{...}` (contains `db_version`,
`current_database_url` for a sqlite snapshot) and `response_data.data[]` = tables
`{table_name, need_to_delete_all, delete_ids?, records[]}`. Tables: `CAR_DETAIL`,
`INSPECTION_DETAILS`, `CONFIG_CITY`, `MENU`, `CATEGORY` (city hall directory, unrelated),
`RAI_CATEGORY` (41), `RAI_SUBCATEGORY` (281).

### 7.1 `RAI_CATEGORY` record

All values are strings except `mandatory_contact_info` (an object).

| Field | Definition |
| --- | --- |
| `cat_id`, `server_id` | category id (equal in KCMO). Send `cat_id` as `type_id`, `server_id` as `issue_cat_id` / `issue_type_id`. |
| `menu_id` | `"10871"` |
| `name`, `sort_order`, `category_image` | display |
| `type` | `"Standard"` (37) or `"form_type"` (4). Compare case-insensitively (the app constant is `"standard"`). |
| `form_data` | JSON **string** of the question array (section 7.3). Non-empty only on `form_type` categories. |
| `allow_multiple_subtypes` | `"yes"`/`"no"` |
| `location_required` | `"yes"` (32) / `"no"` (9) |
| `description_required` | `"yes"` on 1 category, not enforced by the app |
| `attachment_required` | all `"no"` |
| `allow_image_uploads` | all `"yes"` |
| `login_required` | all `"no"` |
| `contact_info_required` | `"no"` or `""` |
| `mandatory_contact_info` | `{"first_name","last_name","email","phone": "yes"|"no"}`, all `"no"` |
| `enable_disclaimer` | `"yes"` (9). Together with `disclaimer_title`, `disclaimer_text`, `disclaimer_phone`, `disclaimer_url`, `disclaimer_email`, and `disclaimer_json` (JSON string `{total_scripts, scripts:[{id,title,content,order,language,is_active}]}`). |
| `autoresponse_text` | message to show after a successful submit (can contain HTML) |
| `enable_duplicate_issues` | `"yes"` turns on the `searchNearestIssue` pins |
| `prevent_duplicate_issue` | `"0"` off, `"1"` warn, `"2"` block (via `check_duplicate_issue`) |
| `issue_access` | `"all"` / `"citizen"` [guess: visibility in the public list] |
| `share_options` | the default share action (parsed as `share_options`) |
| `no_entry` | `"yes"` on 1 category [guess: informational only, cannot submit], not enforced in the Android code |
| `thirdparty_type`, `thirdparty_id` | CRM routing. `17` is the common value in KCMO. `13` would trigger the contact-info screen. |

### 7.2 `RAI_SUBCATEGORY` record

Same flags as categories, plus `subcat_id`, `category_id` (parent `cat_id`), `cat_order`
(sort key), and no `allow_multiple_subtypes`. `type` values: `form_type` (158), `Standard` (64),
`""` (47, which means "inherit the category type"), `Light Pole Issue Report` (9),
`Abandoned Vehicle Report` (2), `form_type_car` (1). `prevent_duplicate_issue` can be `"2"` (16 rows).

Full pothole example (category 53842 "A Pothole", which has 2 subcategories):

```json
{
 "subcat_id": "44019",
 "server_id": "44019",
 "name": "Pothole in the Street",
 "category_id": "53842",
 "menu_id": "10871",
 "autoresponse_text": "Currently Public Works is dealing with a high level of requests, and it can take up to 60 days to resolve. We appreciate your reporting and patience.",
 "cat_order": "2",
 "enable_disclaimer": "yes",
 "form_data": "[{\"type\":4,\"caption\":\"Number of Potholes\",\"placeholder\":\"\",\"sort_order\":1,\"IS_INPUT_REQUIRED\":\"yes\",\"allow_multiple_select\":\"no\",\"dropdown_options\":[{\"id\":\"One pothole\",\"value\":\"One pothole\"},{\"id\":\"Multiple potholes\",\"value\":\"Multiple potholes\"},{\"id\":\"Entire block\",\"value\":\"Entire block\"}]}]",
 "type": "form_type",
 "thirdparty_type": "17",
 "thirdparty_id": "Streets / Roadways / Alleys-Pothole",
 "contact_info_required": "no",
 "login_required": "no",
 "location_required": "yes",
 "description_required": "no",
 "no_entry": "no",
 "attachment_required": "no",
 "enable_duplicate_issues": "yes",
 "prevent_duplicate_issue": "2",
 "issue_access": "all",
 "disclaimer_title": "Important!",
 "disclaimer_text": "Kansas City only repairs potholes found on city streets within city limits. If you encounter potholes on highways or on/off ramps, please notify MODOT at 816-607-2000",
 "disclaimer_phone": "",
 "disclaimer_url": "",
 "disclaimer_email": "",
 "disclaimer_json": "{\"total_scripts\":1,\"disclaimer_phone\":\"\",\"disclaimer_url\":\"\",\"disclaimer_email\":\"\",\"scripts\":[{\"id\":\"manual_1783433312041\",\"title\":\"Important!\",\"content\":\"Kansas City only repairs potholes found on city streets within city limits. If you encounter potholes on highways or on/off ramps, please notify MODOT at 816-607-2000\",\"order\":1,\"language\":\"en\",\"is_active\":true}]}",
 "allow_image_uploads": "yes",
 "mandatory_contact_info": {"first_name": "no", "last_name": "no", "email": "no", "phone": "no"}
}
```

Thus, a pothole report: `type = "form_type"`, `type_id = "53842"`, `name = "A Pothole"`,
`issue_cat_id = "53842"`, `subtype = "Pothole in the Street"`, one question whose answer is
one of the three option ids. `check_duplicate_issue` blocks a second report of the same
subcategory at the same address (`prevent_duplicate_issue = "2"`).

(Another subcategory named "Pothole", id 26708, sits under "Bridge" (11261), with a
type-3 question "Number of potholes on bridge?".)

### 7.3 `form_data` question schema

`form_data` is a JSON array encoded **as a string** inside the record. Parse it with
`json.loads` a second time. Question keys [probe: 417 questions over all records, code:
`DBParser.parseFormData`]:

| Key | Present | Definition |
| --- | --- | --- |
| `type` | always | int, section 3.4 |
| `caption` | always | question text, also the answer key |
| `placeholder` | always | hint (the parser also accepts `Placeholder`) |
| `sort_order` | always | int |
| `IS_INPUT_REQUIRED` | always | `"yes"` (271) / `"no"` (146). `"1"` also means required. |
| `allow_multiple_select` | type 4 | `"yes"`/`"no"` |
| `dropdown_options` | type 4 | `[{"id","value"}]`. Show `value`, send `id`. In KCMO `id` equals `value`. |
| `regex` | rare (1 question) | Java regex. The app tests it with `find()` (a partial match), only for a non-empty answer. |
| `id` | rare (1 question) | unused |

Distinct types in KCMO data: **1** (Yes/No, 95 questions), **3** (text, 149), **4**
(dropdown, 139), **5** (date+time, 21), **6** (date, 13). Types 2 and 7 exist in code only.
Type 1 has no required check in the app (a radio always has a value).

---

## 8. `add_comments_citizen` (add a note or photo to my report). WRITES

Not called. Flat parts [code: `RAIReportDetailActivity.createPostKeyValueJson`]:

| Part | Value |
| --- | --- |
| `issue_id` | MyCivic id of the report |
| `notes` | comment text (`""` for a photo-only comment) |
| `city_id` | city hash |
| `notify` | `""` |
| `api_version` | `"6.0"` |
| `notifyids` | `""` |
| `attachments` | `"[CAM<ms>.jpeg,CAM<ms>.jpeg]"`. A literal bracketed, comma-joined string of the ZIP entry names, without quotes. Only present with photos. |
| `offline_timestamp` | GMT epoch ms as a string |
| `sessionkey` | only if logged in |
| `file_zip` (file) | ZIP as in section 3.6. The app attaches the zip file whenever it exists. |

No `device_id` part is sent. The device comes only from the JWT `deviceuid` claim. The app
does not send a comment that has neither text nor photos.

Response (top-level envelope): the app checks that `response_message` contains `"success"`
(case-insensitive). Then `response_data` is an **array** whose `[0]` is the updated issue
object (section 5.1 fields) [code: `parseStaffCommentAPIControllerResponse`].
The comment box is gated by `citizen_allow_to_send_note` and `hide_add_photos`.

## 9. `rai_report_rating` (rate a resolved report). WRITES

Not called. Multipart [code: `FeedbackNoteFragment.callSubmit` / `callSubmitRAIReportRating`]:

- `rating_details`: JSON string
  `{"city_id","device_id","deviceuid","first_name","last_name","email_address","phone_number","rating","report_id","notes","api_version":"6.0"}`
  - `rating` is the index of the selected star as a string. The range (0-based or 1-based)
    is not known [guess: 0..4 or 1..5].
  - `report_id` is the `myissues` element's **`city_report_id`**, not `id`.
  - The contact keys are named `email_address` / `phone_number` here (not `email` / `phone`),
    and are sent only if contact info exists locally.
- `file_zip`: ZIP named `feedbackImages.zip` (optional).

Response: `{"response_status":{"response_code":1,"response_message":"..."}}`. `1` is success, `0` is failure.

## 10. Other endpoints (for reference, not probed)

- `register_device` (writes): one part `POST_JSON` with `{city_id, deviceuid, device_id,
  devicetoken (FCM token or ""), api_version, clientid:"", devicename (manufacturer),
  devicemodel (Build.PRODUCT), deviceversion (Android release), latitude, longitude (numbers,
  0.0 if unknown), container_app_id:""}`. The app calls it at every launch after FCM
  registration and ignores the result. It is only needed for push notifications [guess].
- `delete_report_from_device` (writes): flat `city_id, api_version, device_id, issue_id`
  (= `city_report_id`). It removes the report from this device's list.
- `notification_history`, `update_notification_status`: push inbox (not documented here).

---

## 11. Open questions

1. Does `report_an_issue` succeed for a `deviceuid` that never called `register_device`?
   (The reads all do.)
2. Which `SELECTED_SUB_TYPE` keys does the server read, and is the local `Id` needed?
3. (Map half answered 2026-10-06: a `private` ADA curb report filed 2026-10-05 is missing from
   `reported_issues_map`, while a newer public report of the same type 70 m away is on it.)
   Does `share_options: "private"` hide a report from `reported_issues_list` / map, and does
   it hide `reporter_*` from `get_issue_detail_citizen` for other devices?
4. Exact `report_an_issue` response body. Only `response_status.response_code`,
   `response_message` and `work_order` are known. Is `work_order` the KC case number
   immediately, or only after the CRM sync (`thirdparty_call_timestamp`)?
5. Does the server pair `files_metadata[].filename` with the ZIP entry names, or does it take
   all ZIP entries in order?
6. The `rating` index base for `rai_report_rating`.
7. Does the server enforce `description_required` / `no_entry` / `mandatory_contact_info`
   (the Android app does not)?
8. `myissues` element fields are from the parser only. No live non-empty sample exists.
9. Is `searchNearestIssue` really limited to approximately 90 days and every status
   (the probe saw `received`, `canceled`, `resolved`, `new`)?
