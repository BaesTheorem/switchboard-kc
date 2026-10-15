#!/usr/bin/env python3
"""Write KC311/Resources/HealthCenters.json: active federally funded health
center sites within 20 miles of downtown Kansas City, from HRSA's national
site file (14 MB, too big to download on a phone). testflight.sh runs this
before each upload, so every build carries a fresh copy."""
import csv
import io
import json
import math
import urllib.request
from pathlib import Path

URL = "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
OUT = Path(__file__).resolve().parent.parent / "KC311" / "Resources" / "HealthCenters.json"
LAT, LON, MILES = 39.0997, -94.5786, 20

req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
text = urllib.request.urlopen(req, timeout=300).read().decode("utf-8-sig")
out = []
for r in csv.DictReader(io.StringIO(text)):
    try:
        lat = float(r["Geocoding Artifact Address Primary Y Coordinate"])
        lon = float(r["Geocoding Artifact Address Primary X Coordinate"])
    except ValueError:
        continue
    if r["Site Status Description"] != "Active":
        continue
    if math.hypot((lat - LAT) * 69, (lon - LON) * 53.6) > MILES:
        continue
    out.append({
        "name": r["Site Name"].strip(),
        "org": r["Health Center Name"].strip().title(),
        "address": f'{r["Site Address"].strip()}, {r["Site City"].strip()}, {r["Site State Abbreviation"]} {r["Site Postal Code"][:5]}',
        "phone": r["Site Telephone Number"].strip(),
        "web": r["Site Web Address"].strip(),
        "hours": r["Operating Hours per Week"].strip(),
        "lat": lat, "lon": lon,
    })
OUT.write_text(json.dumps(sorted(out, key=lambda x: x["name"]), indent=1))
print(f"wrote {len(out)} health center sites to {OUT.name}")
