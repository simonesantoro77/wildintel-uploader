"""Convert the common WildINTEL field datasheet (16 columns: Trappers, Session, Date, Time, DateTime, Site, Camera, Action, Status,
CardBatteriesOK, NumPhotos, SD, DateTimeOK, Notes, Longitude, Latitude) into the WildINTEL Epicollect CSV, the file the new field
form downloads, so that the WildINTEL Uploader reads it with Register the visits > WildINTEL Epicollect CSV.
usage: python tools/convert_field_datasheet.py datasheet.csv output.csv [time zone of Date/Time, e.g. Europe/Warsaw or UTC]"""
import csv, re, sys, uuid
from datetime import datetime
from zoneinfo import ZoneInfo

HEADER = ["ec5_uuid", "created_at", "uploaded_at", "created_by", "title", "1_setupBy", "2_Revision", "3_locationID",
          "4_Status_of_the_came", "5_Batteries_Status", "6_Card_Status", "7_N_pictures_collect", "8_Date_and_time_OK",
          "9_Action_after_inspe", "10_Action_after_thef", "11_cameraModel", "12_Camera_name", "13_Serial_number",
          "14_cameraHeight", "15_cameraDelay", "16_cameraTilt", "17_cameraHeading", "18_detectionDistance", "19_baitUse",
          "20_featureType", "21_habitat", "22_SD_to_insert", "23_Calibration", "24_Observations", "lat_25_Coordinates",
          "long_25_Coordinates", "accuracy_25_Coordinates", "UTM_Northing_25_Coordinates", "UTM_Easting_25_Coordinates",
          "UTM_Zone_25_Coordinates"]
src, dst = sys.argv[1], sys.argv[2]
zone = ZoneInfo(sys.argv[3] if len(sys.argv) > 3 else "UTC")
rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
problems = []

def when(r):
    return datetime.strptime(f"{r['Date'].strip()} {r['Time'].strip()[:5]}", "%Y-%m-%d %H:%M")

def utc(r):
    return when(r).replace(tzinfo=zone).astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def act(r):
    return r["Action"].strip().lower()

def collected(r, out):
    code = re.sub(r"[\s_]", "", r["CardBatteriesOK"]).lower()
    out["5_Batteries_Status"] = "No batteries" if "nobatter" in code else "OK"
    full = "cardfull" in code
    out["6_Card_Status"] = "Full Card" if full else "OK"
    n = r["NumPhotos"].strip()
    out["7_N_pictures_collect"] = "" if full or not re.fullmatch(r"\d+", n) else n
    if not full and not re.fullmatch(r"\d+", n):
        problems.append(f"{r['Session']} {r['Site']}: no image count ({n or 'empty'}) - turn on 'The images were not counted'")
    ok = r["DateTimeOK"].strip().lower()
    out["8_Date_and_time_OK"] = "OK" if ok == "ok" else ("Bad (﹥ 10 min)" if ok else "")

def status(r):
    s = r["Status"].strip().lower()
    if s.startswith("alter"): return "Altered", ""
    if s.startswith("knock"): return "Altered", "Knocked down. "
    return "OK", ""

def put_up(r, out):
    out["12_Camera_name"] = r["Camera"].strip()
    out["22_SD_to_insert"] = r["SD"].strip()
    out["23_Calibration"] = "No"
    m = re.search(r"(\d{2,3})\s*cm", r["Notes"])
    out["14_cameraHeight"] = m.group(1) if m else ""

def base(r):
    out = dict.fromkeys(HEADER, "")
    out["ec5_uuid"] = str(uuid.uuid4())
    out["created_at"] = out["uploaded_at"] = utc(r)
    out["created_by"] = "historic.datasheet"
    out["title"] = f"{r['Session']} {r['Site']}"
    out["1_setupBy"] = ", ".join(t.strip() for t in r["Trappers"].split(",") if t.strip())
    out["2_Revision"], out["3_locationID"] = r["Session"].strip(), r["Site"].strip()
    out["lat_25_Coordinates"], out["long_25_Coordinates"] = r["Latitude"].strip(), r["Longitude"].strip()
    return out

groups = {}
for r in rows:
    groups.setdefault((r["Session"].strip(), r["Site"].strip()), []).append(r)
last = max(s for s, _ in groups)
later = lambda site, ses: any(s > ses and t == site for (s, t) in groups)
def gone(site, ses):
    """A site with no visit after this one is given up - but in the last revision nobody knows yet: it stays open."""
    if ses == last:
        problems.append(f"{ses} {site}: camera taken away or stolen in the last revision - kept open; say Site removal if the site was given up")
        return False
    return not later(site, ses)
seen, out_rows = set(), []
for (ses, site), g in sorted(groups.items(), key=lambda kv: min(when(r) for r in kv[1])):
    g.sort(key=when)
    kinds = [act(r) for r in g]
    take = next((r for r in g if act(r) in ("revision", "desinstallation", "stolen")), None)
    put = next((r for r in g if act(r) == "installation"), None)
    if len(g) > 2 or (take and kinds.count(act(take)) > 1):
        problems.append(f"{ses} {site}: {len(g)} rows ({', '.join(kinds)}) - one visit per site and revision: check by hand")
    notes = []
    if take is None:                                   # only a camera put up
        out = base(put); put_up(put, out)
        out["4_Status_of_the_came"] = "Inactive site" if site in seen else "New site"
    elif act(take) == "stolen":
        out = base(take); out["4_Status_of_the_came"] = "Stolen"
        if put: out["10_Action_after_thef"] = "Camera replacement"; put_up(put, out)
        else: out["10_Action_after_thef"] = "Site removal" if gone(site, ses) else "None"
    else:
        out = base(take); out["4_Status_of_the_came"], pre = status(take); notes.append(pre)
        collected(take, out)
        if act(take) == "revision":
            out["9_Action_after_inspe"] = "Keep the camera"; out["22_SD_to_insert"] = take["SD"].strip(); out["23_Calibration"] = "No"
            if put: problems.append(f"{ses} {site}: a Revision and an Installation - check by hand")
        elif put:
            out["9_Action_after_inspe"] = "Camera replacement"; put_up(put, out)
        else:
            out["9_Action_after_inspe"] = "Site removal" if gone(site, ses) else "Camera removal"
    notes += [r["Notes"].strip() for r in g]
    out["24_Observations"] = " | ".join(n.strip() for n in notes if n.strip())
    out_rows.append(out); seen.add(site)

with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=HEADER); w.writeheader(); w.writerows(out_rows)
print(f"{len(rows)} datasheet rows -> {len(out_rows)} visits")
for p in problems: print("CHECK:", p)
