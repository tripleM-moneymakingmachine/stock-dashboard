#!/usr/bin/env python3
"""Refreshes the holdings of auto-updated 13F panels in data/portfolios.json (currently Soros).

For each entry with an "auto" block, checks SEC EDGAR for the filer's latest 13F-HR. When its accession
differs from the one in the config, downloads the information table, folds rows by CUSIP and option type,
maps CUSIPs to tickers with OpenFIGI, and rewrites the entry's holdings, period, filed, next_due,
accession and "previous" summary. Stock and call rows become holdings (calls valued at the underlying
shares, as filed); puts and convertible notes/bonds are left out of the table and summarised in the note,
since they can't be marked to a share price. Only the largest auto.max_rows rows are kept, so the
10-minute live refresh stays quick.

Network errors are printed and leave the config unchanged. Exit code is always 0.

Usage: python3 scripts/update-13f.py
"""
import datetime as dt, json, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(ROOT, "data", "portfolios.json")
UA = os.environ.get("SEC_USER_AGENT") or "stock-dashboard admin@example.com"


def get(url, data=None, headers=None):
    h = {"User-Agent": UA, "Accept-Encoding": "identity", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=60) as f:
        return f.read()


def latest_13f(cik):
    j = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    rc = j["filings"]["recent"]
    k = next(i for i, f in enumerate(rc["form"]) if f == "13F-HR")
    return {"accession": rc["accessionNumber"][k], "period": rc["reportDate"][k], "filed": rc["filingDate"][k]}


def info_table(cik, acc):
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/"
    items = json.loads(get(base + "index.json"))["directory"]["item"]
    xmls = [it["name"] for it in items if it["name"].lower().endswith(".xml") and it["name"].lower() != "primary_doc.xml"]
    if not xmls:
        raise RuntimeError("no information table xml in " + base)
    xmls.sort(key=lambda n: ("info" not in n.lower(), n))
    root = ET.fromstring(get(base + xmls[0]))
    strip = lambda t: t.split("}", 1)[-1]
    rows = []
    for it in root.iter():
        if strip(it.tag) != "infoTable":
            continue
        f = {}
        for c in it.iter():
            tag = strip(c.tag)
            if c.text and c.text.strip():
                f[tag] = c.text.strip()
        rows.append({"name": f.get("nameOfIssuer", ""), "cls": f.get("titleOfClass", ""), "cusip": f.get("cusip", "").upper(),
                     "value": float(f.get("value", 0) or 0), "sh": float(f.get("sshPrnamt", 0) or 0),
                     "type": f.get("sshPrnamtType", "SH"), "pc": (f.get("putCall") or "").lower()})
    return rows


def fold(rows):
    """sum rows that share a CUSIP and option type (a filing splits them by manager / discretion)"""
    out = {}
    for r in rows:
        k = (r["cusip"], r["pc"], r["type"])
        if k in out:
            out[k]["value"] += r["value"]; out[k]["sh"] += r["sh"]
        else:
            out[k] = dict(r)
    return list(out.values())


def figi(cusips):
    """CUSIP -> US ticker via OpenFIGI (no key: 10 ids per request, 25 requests a minute)"""
    m = {}
    cusips = sorted(set(cusips))
    for i in range(0, len(cusips), 10):
        batch = cusips[i:i + 10]
        body = json.dumps([{"idType": "ID_CUSIP", "idValue": c, "exchCode": "US"} for c in batch]).encode()
        for attempt in range(3):
            try:
                res = json.loads(get("https://api.openfigi.com/v3/mapping", body, {"Content-Type": "application/json"}))
                break
            except Exception as e:
                print("openfigi retry", attempt, e); time.sleep(15)
        else:
            continue
        for c, r in zip(batch, res):
            d = (r.get("data") or [None])[0]
            if d and d.get("ticker"):
                m[c] = d["ticker"].replace("/", "-").replace(" ", "-")
        time.sleep(2.6)
    return m


def nice(name):
    s = re.sub(r"\s+", " ", name).strip().title()
    for a, b in (("Inc", "Inc"), (" Corp", " Corp"), (" Plc", " plc"), (" Ltd", " Ltd"), (" Hldgs", " Holdings"), (" Intl", " International")):
        s = s.replace(a, b)
    return s


def next_due(period):
    q = dt.date.fromisoformat(period)
    nq = {3: dt.date(q.year, 6, 30), 6: dt.date(q.year, 9, 30), 9: dt.date(q.year, 12, 31), 12: dt.date(q.year + 1, 3, 31)}[q.month]
    d = nq + dt.timedelta(days=45)
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d.isoformat()


def bn(x):
    return f"${x / 1e9:.1f}B" if x >= 1e9 else f"${x / 1e6:.0f}M"


def update(key, T):
    cik, auto = T["cik"], T["auto"]
    lf = latest_13f(cik)
    if lf["accession"] == T.get("accession"):
        print(f"{key}: up to date ({lf['accession']})")
        return False
    rows = fold(info_table(cik, lf["accession"]))
    # values: since 2023 filings report whole dollars; older ones were in $000
    total = sum(r["value"] for r in rows)
    if total < 1e8:
        for r in rows:
            r["value"] *= 1000
        total *= 1000
    eq = [r for r in rows if r["type"] == "SH" and r["pc"] in ("", "call")]
    puts = [r for r in rows if r["pc"] == "put"]
    notes = [r for r in rows if r["type"] == "PRN" and not r["pc"]]
    eq.sort(key=lambda r: -r["value"])
    top_puts = sorted(puts, key=lambda r: -r["value"])[:5]
    tick = figi([r["cusip"] for r in eq[: auto.get("max_rows", 60) + 25] + top_puts])
    hold, skipped = [], []
    for r in eq:
        t = tick.get(r["cusip"])
        if not t:
            skipped.append(r["name"]); continue
        h = [t, nice(r["name"]) + (" (ADS)" if "ADS" in r["cls"].upper() or "ADR" in r["cls"].upper() else ""), int(r["sh"]), round(r["value"])]
        if r["pc"] == "call":
            h.append("call")
        hold.append(h)
        if len(hold) >= auto.get("max_rows", 60):
            break
    if len(hold) < 5:
        raise RuntimeError(f"only {len(hold)} rows mapped to tickers; keeping the old holdings")

    # change summary vs the holdings we had (by ticker and kind)
    old = {(h[0], (h[4:] or [""])[0]): h[2] for h in T.get("holdings", [])}
    new = {(h[0], (h[4:] or [""])[0]): h[2] for h in hold}
    prev_total = T.get("reported_total")
    diff = bool(T.get("accession"))  # a hand-seeded entry (no accession) has nothing reliable to diff against
    big_new = [k[0] for k in new if k not in old][:6]
    gone = [k[0] for k in old if k not in new][:6]
    up = sorted([k for k in new if k in old and old[k] and new[k] / old[k] > 1.5], key=lambda k: -new[k] / old[k])[:5]
    parts = []
    if prev_total:
        parts.append(f"Vs the prior filing: reported value {bn(prev_total)} → {bn(total)}, positions {T.get('reported_positions', '?')} → {len(rows)}")
    else:
        parts.append(f"Reported value {bn(total)} across {len(rows)} positions")
    if diff and big_new:
        parts.append("new or into the top rows: " + ", ".join(big_new))
    if diff and up:
        parts.append("built up: " + ", ".join(k[0] for k in up))
    if diff and gone:
        parts.append("out of the table: " + ", ".join(gone))
    put_txt = ""
    if puts:
        put_txt = f" Puts (hedges, not in the table): {bn(sum(r['value'] for r in puts))} notional, largest " + \
                  ", ".join(f"{tick.get(r['cusip']) or nice(r['name'])} {bn(r['value'])}" for r in top_puts) + "."
    note_txt = f" Convertible notes/bonds left out: {bn(sum(r['value'] for r in notes))}." if notes else ""

    h0 = T.get("highlights") or {}
    hl = h0["text"] + " " if h0.get("period") == lf["period"] and h0.get("text") else ""
    T.update({"accession": lf["accession"], "period": lf["period"], "filed": lf["filed"], "next_due": next_due(lf["period"]),
              "reported_total": round(total), "reported_positions": len(rows),
              "previous": hl + "; ".join(parts) + "." + put_txt + note_txt,
              "holdings": hold})
    print(f"{key}: updated to {lf['accession']} ({lf['period']}), {len(hold)} rows, {len(skipped)} unmapped")
    return True


def main():
    cfg = json.load(open(CFG_PATH))
    changed = False
    for key, T in cfg.items():
        if isinstance(T, dict) and T.get("auto"):
            try:
                changed |= update(key, T)
            except Exception as e:
                print(f"{key}: not updated: {e}")
    if changed:
        with open(CFG_PATH, "w") as f:
            json.dump(cfg, f, indent=1, ensure_ascii=False)
            f.write("\n")


if __name__ == "__main__":
    main()
