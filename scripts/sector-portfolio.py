#!/usr/bin/env python3
"""Sector portfolio for the Portfolio tab: data/sector-portfolio.json.

One semiconductor stock as the growth engine plus five sector winners chosen to hold up when tech
sells off (healthcare, consumer staples, energy, financials, industrials/aerospace).

Rules:
  * Holdings: one stock per sector. data/sector-portfolio-config.json `history` lists every change of
    holdings (applied at that date's close). Targets: semis 30%, every other sector 14%.
  * Rebalanced back to target at the first close of each quarter, or at any close where a weight has
    drifted more than `driftBand` (5 points) from target. Trading costs 0.10% of the value traded.
  * Sector check, run on every close over the trailing `lookback` sessions (252 = 12 months):
    every candidate is scored on Sharpe ratio, 6-month momentum per unit of risk and downside capture
    against the Nasdaq Composite (score = rank(Sharpe) + rank(momentum/risk) + 0.5 x rank(downside
    capture); lower is better). A challenger replaces the holding only if it passes all four tests:
      1. it has the best score in the sector;
      2. its 12-month Sharpe beats the holding's by more than `sharpeMargin` (0.3);
      3. its downside capture is no worse than the holding's;
      4. its latest quarter agrees: it beat consensus and either the holding missed or the
         challenger's EPS grew at least as fast (from `earnings` in the config).
    Swaps are recorded in the config's `history` (by the daily portfolio task) and take effect at
    that close.
  * Prices are dividend-adjusted closes from data/sector-prices.json (scripts/fetch-sector-prices.mjs).
Pure standard library so it runs in the GitHub Action without installs.

Usage: python3 scripts/sector-portfolio.py [--text]
"""
import json, math, os, sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "data", "sector-portfolio-config.json")))
PX = json.load(open(os.path.join(ROOT, "data", "sector-prices.json")))["px"]
OUT = os.path.join(ROOT, "data", "sector-portfolio.json")

R = CFG["rules"]
LB, MARGIN, BAND, RF, COST = R["lookback"], R["sharpeMargin"], R["driftBand"], R["rf"], R["cost"]
SECT = CFG["sectors"]
SECS = list(SECT)
NDX, SPY = CFG["benchmarks"]["nasdaq"], CFG["benchmarks"]["spy"]
NAMES = CFG["names"]
START = CFG["start"]
HIST = sorted(CFG["history"], key=lambda e: e["date"])


def sd(x):
    m = sum(x) / len(x)
    return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1)) if len(x) > 1 else 0.0


# ---------- aligned prices ----------
dates = [d for d in PX[NDX]["d"] if d >= START]
P = {}
for s, v in PX.items():
    m = dict(zip(v["d"], v["a"]))
    out, last = [], None
    for d in dates:
        last = m.get(d, last)
        out.append(last)
    if out[0] is None:  # not listed at the start: back-fill with its first price (flat until it trades)
        first = next(x for x in out if x is not None)
        out = [x if x is not None else first for x in out]
    P[s] = out
N = len(dates)
RET = {s: [0.0] + [P[s][i] / P[s][i - 1] - 1 for i in range(1, N)] for s in P}
qtr = lambda d: (d[:4], (int(d[5:7]) - 1) // 3)


def targets(hold, semis_w=None):
    w = {}
    sw = SECT["Semis"]["weight"] if semis_w is None else semis_w
    other = (1 - sw) / (len(SECS) - 1)
    for sec in SECS:
        w[hold[sec]] = sw if sec == "Semis" else (SECT[sec]["weight"] if semis_w is None else other)
    return w


def simulate(semis_w=None, drift=True):
    """NAV path with the config history, quarterly + drift rebalancing and trading costs."""
    ev = {e["date"]: e for e in HIST}
    hold = HIST[0]["hold"]
    tw = targets(hold, semis_w)
    val = {t: w * (1 - COST) for t, w in tw.items()}
    nav, log, wts = [sum(val.values())], [{"d": dates[0], "kind": "start", "w": tw, "why": HIST[0]["why"]}], []
    wts.append({t: v / nav[0] for t, v in val.items()})
    for i in range(1, N):
        val = {t: v * (1 + RET[t][i]) for t, v in val.items()}
        tot = sum(val.values())
        cur = {t: v / tot for t, v in val.items()}
        d = dates[i]
        kind, why = None, ""
        if d in ev and ev[d]["hold"] != hold:
            hold = ev[d]["hold"]; tw = targets(hold, semis_w); kind, why = "swap", ev[d]["why"]
        if kind is None and qtr(d) != qtr(dates[i - 1]):
            kind = "quarterly"
        if kind is None and drift and any(abs(cur.get(t, 0) - w) > BAND for t, w in tw.items()):
            kind = "drift"
        if kind:
            traded = sum(abs(tw.get(t, 0) - cur.get(t, 0)) for t in set(tw) | set(cur)) * tot
            tot -= traded * COST
            log.append({"d": d, "kind": kind, "w": tw, "pre": {t: round(x, 4) for t, x in cur.items()}, "why": why})
            val = {t: w * tot for t, w in tw.items()}
            cur = dict(tw)
        nav.append(tot)
        wts.append(cur)
    return nav, log, wts, hold


def stats(nav, bench=None):
    r = [nav[i] / nav[i - 1] - 1 for i in range(1, len(nav))]
    yrs = len(r) / 252
    tot = nav[-1] / nav[0] - 1
    cagr = (1 + tot) ** (1 / yrs) - 1
    vol = sd(r) * math.sqrt(252)
    dn = [x for x in r if x < 0]
    peak, mdd, pk_i = -1e9, 0, 0
    for i, v in enumerate(nav):
        if v > peak: peak, pk_i = v, i
        mdd = min(mdd, v / peak - 1)
    o = {"total": tot, "cagr": cagr, "vol": vol, "sharpe": (cagr - RF) / vol if vol else None,
         "sortino": (cagr - RF) / (sd(dn) * math.sqrt(252)) if len(dn) > 1 else None, "maxdd": mdd,
         "fromHigh": nav[-1] / max(nav) - 1, "peak": dates[nav.index(max(nav))], "vol3m": sd(r[-63:]) * math.sqrt(252)}
    if bench:
        b = bench
        down = [i for i in range(len(b)) if b[i] < 0]
        up = [i for i in range(len(b)) if b[i] > 0]
        mean = lambda xs: sum(xs) / len(xs)
        o["downCap"] = mean([r[i] for i in down]) / mean([b[i] for i in down])
        o["upCap"] = mean([r[i] for i in up]) / mean([b[i] for i in up])
        mb, mr = mean(b), mean(r)
        o["beta"] = sum((r[i] - mr) * (b[i] - mb) for i in range(len(b))) / sum((x - mb) ** 2 for x in b)
    return o


def path(s):
    return [P[s][i] / P[s][0] for i in range(N)]


# ---------- portfolio and benchmarks ----------
nav, rlog, wts, hold = simulate()
ndx_r = RET[NDX][1:]
semis_now = hold["Semis"]
lines = {"port": nav, "ndx": path(NDX), "spy": path(SPY), "semi": path(semis_now)}
nav_ew, _, _, _ = simulate(semis_w=1 / len(SECS))
nav_50, _, _, _ = simulate(semis_w=0.5)
lines["ew"] = nav_ew
S = {k: stats(v, ndx_r) for k, v in lines.items()}
S["heavy"] = stats(nav_50, ndx_r)


def dd(v):
    pk, o = -1e9, []
    for x in v:
        pk = max(pk, x); o.append(round(x / pk - 1, 5))
    return o


# Nasdaq selloffs: peak-to-trough declines deeper than 6%
eps, eq = [], lines["ndx"]
pk_i, in_dd, trough_i = 0, False, 0
for i in range(1, N):
    if eq[i] >= eq[pk_i]:
        if in_dd and eq[trough_i] / eq[pk_i] - 1 < -0.06:
            eps.append((pk_i, trough_i))
        pk_i, in_dd = i, False
    else:
        if not in_dd: in_dd, trough_i = True, i
        if eq[i] < eq[trough_i]: trough_i = i
if in_dd and eq[trough_i] / eq[pk_i] - 1 < -0.06:
    eps.append((pk_i, trough_i))
selloffs = [{"from": dates[a], "to": dates[b], "ongoing": b == N - 1 or eq[-1] < eq[a],
             **{k: lines[k][b] / lines[k][a] - 1 for k in ["port", "ew", "semi", "ndx", "spy"]}} for a, b in eps]

# ---------- holdings now ----------
last_reb = rlog[-1]["d"]
li = dates.index(last_reb)


def held_since(sec, t):
    since = None
    for e in HIST:
        if e["hold"][sec] == t:
            since = since or e["date"]
        else:
            since = None
    return since


def window_stats(t, end=N - 1):
    lo = max(1, end - LB + 1)
    r = RET[t][lo:end + 1]
    b = RET[NDX][lo:end + 1]
    ann = 1.0
    for x in r: ann *= 1 + x
    ann = ann ** (252 / len(r)) - 1
    vol = sd(r) * math.sqrt(252)
    down = [i for i in range(len(b)) if b[i] < 0]
    dcap = (sum(r[i] for i in down) / len(down)) / (sum(b[i] for i in down) / len(down))
    m6 = P[t][end] / P[t][max(0, end - 126)] - 1
    m3 = P[t][end] / P[t][max(0, end - 63)] - 1
    v3 = sd(RET[t][max(1, end - 62):end + 1]) * math.sqrt(252)
    return {"ret12": ann, "vol": vol, "sharpe": (ann - RF) / vol, "mom6": m6, "mom3": m3, "ram6": m6 / (vol / math.sqrt(2)),
            "dcap": dcap, "vol3m": v3}


def rank(vals, reverse):
    order = sorted(vals, key=lambda k: vals[k], reverse=reverse)
    return {k: order.index(k) + 1 for k in vals}


check = []
for sec in SECS:
    cands = SECT[sec]["candidates"]
    st = {t: window_stats(t) for t in cands}
    r1, r2, r3 = rank({t: st[t]["sharpe"] for t in cands}, True), rank({t: st[t]["ram6"] for t in cands}, True), rank({t: st[t]["dcap"] for t in cands}, False)
    for t in cands: st[t]["score"] = r1[t] + r2[t] + 0.5 * r3[t]
    order = sorted(cands, key=lambda t: (st[t]["score"], -st[t]["sharpe"]))
    for i, t in enumerate(order): st[t]["rank"] = i + 1
    inc, top = hold[sec], order[0]
    tests = None
    if top != inc:
        E = CFG["earnings"]
        e_top, e_inc = E.get(top), E.get(inc)
        t4 = None
        if e_top and e_inc:
            t4 = bool(e_top["beat"] and ((not e_inc["beat"]) or e_top["epsYoY"] >= e_inc["epsYoY"]))
        tests = {"t1": True, "t2": st[top]["sharpe"] - st[inc]["sharpe"] > MARGIN, "sharpeLead": st[top]["sharpe"] - st[inc]["sharpe"],
                 "t3": st[top]["dcap"] <= st[inc]["dcap"], "t4": t4}
    swap = bool(tests and tests["t2"] and tests["t3"] and tests["t4"])
    check.append({"sector": sec, "role": SECT[sec]["role"], "hold": inc, "top": top, "swap": swap, "tests": tests,
                  "cands": [{"t": t, **{k: round(v, 4) for k, v in st[t].items()}} for t in order]})

cur_w = wts[-1]
holdings = []
for sec in SECS:
    t = hold[sec]
    ws = window_stats(t)
    rk = next(c for c in check if c["sector"] == sec)
    holdings.append({"sector": sec, "t": t, "n": NAMES.get(t, t), "target": targets(hold)[t], "now": cur_w.get(t, 0),
                     "since": held_since(sec, t), "sinceReb": P[t][-1] / P[t][li] - 1, "mom6": ws["mom6"], "mom3": ws["mom3"],
                     "vol3m": ws["vol3m"], "rank": next(c["rank"] for c in rk["cands"] if c["t"] == t), "of": len(rk["cands"])})

# next rebalance preview at the latest close
tw = targets(hold)
if last_reb == dates[-1] and rlog[-1]["kind"] != "start":
    pre = rlog[-1]["pre"]
    prev_hold = None
    reb_rows = []
    for t in sorted(set(pre) | set(tw), key=lambda t: -max(pre.get(t, 0), tw.get(t, 0))):
        a, b = pre.get(t, 0), tw.get(t, 0)
        tag = "IN" if a == 0 else "OUT" if b == 0 else "UP" if b - a > 0.005 else "DOWN" if a - b > 0.005 else "SAME"
        reb_rows.append({"t": t, "n": NAMES.get(t, t), "now": a, "be": b, "tag": tag})
    preview = {"d": dates[-1], "kind": rlog[-1]["kind"], "done": True, "rows": reb_rows, "why": rlog[-1]["why"]}
else:
    new_hold = dict(hold)
    for c in check:
        if c["swap"]: new_hold[c["sector"]] = c["top"]
    nw = targets(new_hold)
    drift = max(abs(cur_w.get(t, 0) - w) for t, w in tw.items())
    rows = []
    for t in sorted(set(cur_w) | set(nw), key=lambda t: -max(cur_w.get(t, 0), nw.get(t, 0))):
        a, b = cur_w.get(t, 0), nw.get(t, 0)
        tag = "IN" if a == 0 else "OUT" if b == 0 else "UP" if b - a > 0.005 else "DOWN" if a - b > 0.005 else "SAME"
        rows.append({"t": t, "n": NAMES.get(t, t), "now": a, "be": b if (new_hold != hold or drift > BAND) else a, "tag": tag if (new_hold != hold or drift > BAND) else "SAME"})
    preview = {"d": dates[-1], "kind": "swap" if new_hold != hold else "drift" if drift > BAND else "none", "done": False, "rows": rows, "maxDrift": drift}

# ---------- daily commentary ----------
notes = CFG.get("notes", {})
daily = []
for i in range(max(1, N - 20), N):
    d = dates[i]
    pr, n, s = nav[i] / nav[i - 1] - 1, RET[NDX][i], RET[SPY][i]
    w0 = wts[i - 1]
    contrib = {t: w0[t] * RET[t][i] for t in w0}
    best, worst = max(contrib, key=contrib.get), min(contrib, key=contrib.get)
    ups = sum(1 for t in w0 if RET[t][i] > 0)
    if n < -0.01 and pr > n:
        tone = (f"The defensive side did its job: the portfolio fell {abs(pr) * 100:.1f}% against {abs(n) * 100:.1f}% for the Nasdaq." if pr < 0
                else f"The portfolio rose {pr * 100:.1f}% while the Nasdaq fell {abs(n) * 100:.1f}%.")
    elif pr > 0 and n < 0:
        tone = f"The portfolio rose {pr * 100:.2f}% while the Nasdaq fell {abs(n) * 100:.2f}%."
    elif pr < 0 and n > 0:
        tone = f"The portfolio slipped {abs(pr) * 100:.2f}% while the Nasdaq rose {n * 100:.2f}%."
    elif n > 0.01 and pr < n:
        tone = f"A risk-on day: the Nasdaq's {n * 100:+.1f}% outran the portfolio's {pr * 100:+.1f}%, the trade-off for holding defensives."
    elif pr < n - 0.005:
        tone = f"The portfolio lagged: {pr * 100:+.2f}% against {n * 100:+.2f}% for the Nasdaq."
    else:
        tone = f"The portfolio returned {pr * 100:+.2f}% against {n * 100:+.2f}% for the Nasdaq."
    txt = (f"{tone} {ups} of {len(w0)} holdings rose. Biggest lift: {best} ({RET[best][i] * 100:+.1f}%, {contrib[best] * 100:+.2f} pts). "
           f"Biggest drag: {worst} ({RET[worst][i] * 100:+.1f}%, {contrib[worst] * 100:+.2f} pts).")
    reb = next((r for r in rlog if r["d"] == d and r["kind"] != "start"), None)
    if reb:
        txt += {"swap": " Holdings changed at the close (see the rebalance log).", "quarterly": " Quarterly rebalance back to target weights at the close.",
                "drift": " A weight drifted more than 5 points from target, so the portfolio was rebalanced at the close."}[reb["kind"]]
    daily.append({"d": d, "port": pr, "ndx": n, "spy": s, "cum": nav[i] / nav[0] - 1, "text": txt, "ctx": notes.get(d, "")})
daily.reverse()


def back(k):  # index of the last session at or before k sessions ago
    return max(0, N - 1 - k)


wk_i = next(i for i in range(N - 1, -1, -1) if date.fromisoformat(dates[i]).isocalendar()[1] != date.fromisoformat(dates[-1]).isocalendar()[1])
periods = {"week": {"from": dates[wk_i], "port": nav[-1] / nav[wk_i] - 1, "ndx": lines["ndx"][-1] / lines["ndx"][wk_i] - 1},
           "month": {"from": dates[back(21)], "port": nav[-1] / nav[back(21)] - 1, "ndx": lines["ndx"][-1] / lines["ndx"][back(21)] - 1}}

# correlations of the current holdings
H = [hold[s] for s in SECS]


def corr(a, b):
    x, y = RET[a][1:], RET[b][1:]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sxy = sum((x[i] - mx) * (y[i] - my) for i in range(len(x)))
    return sxy / math.sqrt(sum((v - mx) ** 2 for v in x) * sum((v - my) ** 2 for v in y))


out = {
    "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "updated": dates[-1], "start": dates[0], "rules": R, "names": NAMES, "folders": CFG.get("folders", {}),
    "sectors": {s: {"role": SECT[s]["role"], "weight": SECT[s]["weight"]} for s in SECS},
    "hold": hold, "stats": S, "holdings": holdings, "preview": preview, "check": check,
    "rebalances": [{k: v for k, v in r.items() if k != "pre"} for r in rlog if r["kind"] in ("start", "swap", "drift")] + [{"d": r["d"], "kind": "quarterly"} for r in rlog if r["kind"] == "quarterly"],
    "series": {"d": dates, **{k: [round(x / v[0], 5) for x in v] for k, v in lines.items()}},
    "dd": {k: dd(lines[k]) for k in ["port", "ndx", "semi"]},
    "selloffs": selloffs, "daily": daily, "periods": periods,
    "corr": {"t": H, "m": [[round(corr(a, b), 2) for b in H] for a in H]},
    "earnings": CFG["earnings"], "study": CFG.get("study"),
}
for r in out["rebalances"]: r.setdefault("why", "")
out["rebalances"].sort(key=lambda r: r["d"], reverse=True)


def rnd(o):
    if isinstance(o, float): return round(o, 5)
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, list): return [rnd(v) for v in o]
    return o


with open(OUT, "w") as f:
    json.dump(rnd(out), f, separators=(",", ":"))
    f.write("\n")

if "--text" in sys.argv:
    s = S["port"]
    print(f"### Sector portfolio, {dates[-1]} close\n")
    print(f"Total {s['total']:+.1%} · CAGR {s['cagr']:+.1%} · Sharpe {s['sharpe']:.2f} · max DD {s['maxdd']:.1%} · from high {s['fromHigh']:.1%} · Nasdaq {S['ndx']['total']:+.1%}\n")
    print("Holdings: " + ", ".join(f"{h['t']} {h['now']:.1%} (target {h['target']:.0%})" for h in holdings) + "\n")
    print(f"Preview ({preview['kind']}): " + ", ".join(f"{r['t']} {r['now']:.1%}→{r['be']:.1%} {r['tag']}" for r in preview["rows"]) + "\n")
    for c in check:
        print(f"- {c['sector']}: hold {c['hold']}, top {c['top']}" + (" → SWAP" if c["swap"] else "") + (f" tests {c['tests']}" if c["tests"] else ""))
