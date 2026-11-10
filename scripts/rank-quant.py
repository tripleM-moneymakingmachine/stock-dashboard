#!/usr/bin/env python3
"""Quantitative multi-factor ranking for the main page's "Most to least bullish" cards.

Every input is a file already in the repo, so the score is reproducible and moves when
the data moves (no anchoring on yesterday's order):

  <t>/data/history.json   500 days OHLCV         -> momentum, trend, risk
  <t>/analysts.json       consensus + actions    -> target revisions, rating drift
  <t>/mgmt.json           last earnings reaction -> post-earnings drift
  <t>/vol.json            30-day implied vol     -> risk
  data/fundamentals.json  growth/margins/P/E     -> growth, quality, value

Method: each sub-factor is turned into a cross-sectional percentile (0-100, ties averaged,
missing = 50) so one outlier (e.g. SNDK's +3,779% EPS) can't dominate. Sub-factors are
averaged into six buckets, buckets are weighted into a 0-100 composite. See WEIGHTS.

Usage:
  python3 scripts/rank-quant.py                 # score as of the latest bar, write data/ranking.json
  python3 scripts/rank-quant.py --asof 2026-11-06
  python3 scripts/rank-quant.py --apply         # also reorder the cards in index.html
  python3 scripts/rank-quant.py --backtest      # IC test of the price-based factors
"""
import json, math, re, sys, html
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARGS = sys.argv[1:]
ASOF = ARGS[ARGS.index("--asof") + 1] if "--asof" in ARGS else None

WEIGHTS = {  # sum = 1.0
    "momentum": 0.25,   # 12-1m and 6-1m risk-adjusted return, 3m return
    "trend":    0.15,   # price vs 50/200-day in ATR units, 50-day slope, gap to 52w high
    "growth":   0.20,   # revenue growth, operating margin, FCF margin
    "value":    0.10,   # forward earnings yield, growth per unit of P/E
    "revision": 0.20,   # 30-day target raises vs cuts, avg target change, rating drift, earnings reaction
    "risk":     0.10,   # low 60-day vol, small 3m drawdown, low implied vol (higher = safer)
}
TIERS = [(62, "bull", "Bullish"), (52, "con", "Constructive"), (42, "neu", "Neutral"), (-1, "cau", "Cautious")]
DIRS = {"TSLA": "tesla"}


def pct_rank(vals):
    """Cross-sectional percentile 0-100 (ties averaged); None -> 50."""
    idx = [i for i, v in enumerate(vals) if v is not None and not (isinstance(v, float) and math.isnan(v))]
    out = [50.0] * len(vals)
    if len(idx) < 2:
        return out
    s = sorted(idx, key=lambda i: vals[i])
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and vals[s[j + 1]] == vals[s[i]]:
            j += 1
        r = (i + j) / 2 / (len(s) - 1) * 100
        for k in range(i, j + 1):
            out[s[k]] = r
        i = j + 1
    return out


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def tickers():
    src = (ROOT / "index.html").read_text()
    return [d for d in re.findall(r'<a class="card t-\w+" href="(\w+)/"', src)]


def sym(d):
    return {v: k for k, v in DIRS.items()}.get(d, d.upper())


def stdev(x):
    m = sum(x) / len(x)
    return math.sqrt(sum((a - m) ** 2 for a in x) / (len(x) - 1))


def price_feats(h, end):
    """Price features using bars up to index `end` (inclusive) only - point in time."""
    c, hi, lo = h["c"][: end + 1], h["h"][: end + 1], h["l"][: end + 1]
    n = len(c)
    if n < 60:
        return {}
    r = [math.log(c[i] / c[i - 1]) for i in range(1, n)]
    vol60 = stdev(r[-60:]) * math.sqrt(252)
    vol1y = stdev(r[-252:]) * math.sqrt(252)
    ret = lambda a, b: c[-1 - b] / c[-1 - a] - 1 if n > a else None  # return from a bars ago to b bars ago
    sma = lambda k: sum(c[-k:]) / k if n >= k else None
    tr = [max(hi[i] - lo[i], abs(hi[i] - c[i - 1]), abs(lo[i] - c[i - 1])) for i in range(n - 20, n)]
    atr = sum(tr) / 20
    s50, s200 = sma(50), sma(200) or sma(100)
    s50_prev = sum(c[-70:-20]) / 50 if n >= 70 else None
    m12 = ret(252, 21)
    m6 = ret(126, 21)
    if m12 is None and n > 100:            # recent listings (SPCX, SKHY ADS): use what exists
        m12 = ret(n - 1, 21)
    win = c[-63:]
    peak, mdd = win[0], 0
    for x in win:
        peak = max(peak, x)
        mdd = min(mdd, x / peak - 1)
    return {
        "m12": m12 / vol1y if m12 is not None else None,
        "m6": m6 / vol1y if m6 is not None else None,
        "m3": ret(63, 0),
        "t50": (c[-1] - s50) / atr,
        "t200": (c[-1] - s200) / atr if s200 else None,
        "slope50": s50 / s50_prev - 1 if s50_prev else None,
        "hi52": c[-1] / max(c[-252:]) - 1,
        "vol60": -vol60,
        "dd3m": mdd,
        "_ret1d": c[-1] / c[-2] - 1, "_ret20": ret(20, 0), "_vol60": vol60, "_close": c[-1],
    }


def revision_feats(a, m, asof):
    out = {}
    d0 = (date.fromisoformat(asof) - timedelta(days=30)).isoformat()
    acts = [x for x in a.get("actions", []) if d0 <= x[0] <= asof]
    up = dn = 0
    chg = []
    for x in acts:
        new, prev = x[5], x[6]
        if x[4] == "up":
            up += 1
        elif x[4] == "down":
            dn += 1
        if new and prev:
            chg.append(new / prev - 1)
            if new > prev:
                up += 1
            elif new < prev:
                dn += 1
    out["breadth"] = (up - dn) / max(len(acts), 1) if acts else None
    out["tgtchg"] = sum(chg) / len(chg) if chg else None
    tr = {row[0]: row[1:] for row in a.get("trend", [])}
    bull = lambda row: (row[0] + row[1]) / max(sum(row), 1)
    past = tr.get("-3m") or tr.get("-2m")
    out["drift"] = bull(tr["0m"]) - bull(past) if "0m" in tr and past else None
    cons = a.get("consensus") or {}
    out["rating"] = -cons["rating"] if cons.get("rating") else None
    rep = (m or {}).get("reported")
    react = ((m or {}).get("react") or {}).get("pct")
    if rep and react is not None and (date.fromisoformat(asof) - date.fromisoformat(rep)).days <= 75:
        out["earn"] = react
    else:
        out["earn"] = None
    out["_n30"], out["_up"], out["_dn"] = len(acts), up, dn
    return out


def score(asof=None):
    ts = tickers()
    fund = load(ROOT / "data/fundamentals.json")["d"]
    rows = []
    for d in ts:
        h = load(ROOT / d / "data/history.json")
        end = len(h["d"]) - 1
        if asof:
            end = max(i for i, x in enumerate(h["d"]) if x <= asof)
        day = h["d"][end]
        f = {"t": d, "sym": sym(d), "date": day}
        f.update(price_feats(h, end))
        f.update(revision_feats(load(ROOT / d / "analysts.json") or {}, load(ROOT / d / "mgmt.json"), day))
        fu = fund.get(sym(d), {})
        f["rev_g"] = fu.get("rev_g")
        f["op_m"] = fu.get("op_m")
        f["fcf_m"] = fu["fcf"] / fu["rev"] if fu.get("fcf") is not None and fu.get("rev") else None
        pe = fu.get("pe_f")
        f["ey"] = 1 / pe if pe and pe > 0 else None
        f["g_per_pe"] = fu["rev_g"] / pe if pe and pe > 0 and fu.get("rev_g") is not None else None
        tgt = fu.get("tgt")
        f["upside"] = tgt / f["_close"] - 1 if tgt else None
        v = load(ROOT / d / "vol.json") or {}
        iv = [x for x in (v.get("cboe") or v.get("aq") or []) if x[0] <= day]
        f["iv"] = -iv[-1][1] if iv else None
        rows.append(f)

    buckets = {
        "momentum": ["m12", "m6", "m3"],
        "trend": ["t50", "t200", "slope50", "hi52"],
        "growth": ["rev_g", "op_m", "fcf_m"],
        "value": ["ey", "g_per_pe"],
        "revision": ["breadth", "tgtchg", "drift", "rating", "earn", "upside"],
        "risk": ["vol60", "dd3m", "iv"],
    }
    # Sub-weights tilted toward what the --backtest IC showed in this universe (Nov 2025-Sep 2026,
    # 11 monthly rebalances): 3m return (IC +0.19) and 50-day slope (+0.22) worked best, 12-1m
    # momentum (+0.01) and the 52w-high gap (+0.02) barely at all. t-stats are < 2, so the tilt is
    # modest (shrunk toward equal weight), not a fit. Analyst targets lag price, so upside is half weight.
    sub_w = {"m12": 0.5, "m3": 1.25, "slope50": 1.5, "hi52": 0.5, "upside": 0.5, "vol60": 0.75}
    pr = {k: pct_rank([r.get(k) for r in rows]) for b in buckets.values() for k in b}
    for i, r in enumerate(rows):
        r["b"] = {}
        for b, ks in buckets.items():
            w = [sub_w.get(k, 1) for k in ks]
            r["b"][b] = round(sum(pr[k][i] * wk for k, wk in zip(ks, w)) / sum(w), 1)
        r["score"] = round(sum(r["b"][b] * w for b, w in WEIGHTS.items()), 1)
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        r["tier"], r["label"] = next((c, l) for th, c, l in TIERS if r["score"] >= th)
    return rows


def backtest():
    """Monthly IC (Spearman) of price factors vs next-21-day return, point in time."""
    ts = tickers()
    H = {d: load(ROOT / d / "data/history.json") for d in ts}
    ref = H["msft"]["d"]
    keys = ["m12", "m6", "m3", "t50", "t200", "slope50", "hi52", "vol60", "dd3m"]
    ic = {k: [] for k in keys + ["price_combo"]}
    spread = []
    for e in range(252, len(ref) - 21, 21):
        day, fwd_day = ref[e], ref[e + 21]
        feats, fwd = [], []
        for d in ts:
            h = H[d]
            if h["d"][0] > ref[e - 120] or fwd_day not in h["d"]:
                continue
            i = max(j for j, x in enumerate(h["d"]) if x <= day)
            f = price_feats(h, i)
            if not f:
                continue
            feats.append(f)
            fwd.append(h["c"][h["d"].index(fwd_day)] / h["c"][i] - 1)
        if len(feats) < 10:
            continue
        fr = pct_rank(fwd)
        pr = {k: pct_rank([f.get(k) for f in feats]) for k in keys}
        mom = [(pr["m12"][j] + pr["m6"][j] + pr["m3"][j]) / 3 for j in range(len(feats))]
        trd = [(pr["t50"][j] + pr["t200"][j] + pr["slope50"][j] + pr["hi52"][j]) / 4 for j in range(len(feats))]
        rsk = [(pr["vol60"][j] + pr["dd3m"][j]) / 2 for j in range(len(feats))]
        combo = [(0.25 * mom[j] + 0.15 * trd[j] + 0.10 * rsk[j]) / 0.5 for j in range(len(feats))]
        for k in keys:
            ic[k].append(corr(pr[k], fr))
        ic["price_combo"].append(corr(pct_rank(combo), fr))
        order = sorted(range(len(feats)), key=lambda j: -combo[j])
        q = max(len(order) // 4, 1)
        top = sum(fwd[j] for j in order[:q]) / q
        bot = sum(fwd[j] for j in order[-q:]) / q
        spread.append((day, top - bot))
    print(f"{len(spread)} monthly rebalances, {spread[0][0]} .. {spread[-1][0]}")
    for k, v in ic.items():
        m = sum(v) / len(v)
        t = m / (stdev(v) / math.sqrt(len(v))) if len(v) > 2 and stdev(v) > 0 else 0
        hit = sum(x > 0 for x in v) / len(v)
        print(f"  IC {k:<12} mean {m:+.3f}  t {t:+.2f}  hit {hit:.0%}")
    s = [x for _, x in spread]
    print(f"  top-quartile minus bottom-quartile, 21d: mean {sum(s)/len(s):+.2%}, hit {sum(x>0 for x in s)/len(s):.0%}")
    return ic, spread


def corr(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else 0


def apply(rows):
    p = ROOT / "index.html"
    src = p.read_text()
    cards = {m.group(1): m.group(0) for m in re.finditer(r'<a class="card t-\w+" href="(\w+)/".*?</a>', src, re.S)}
    first = min(src.find(c) for c in cards.values())
    last = max(src.find(c) + len(c) for c in cards.values())
    seg = src[first:last]
    sep = re.search(r"</a>(\s*)<a", seg).group(1)
    out = []
    for r in rows:
        c = cards[r["t"]]
        c = re.sub(r'class="card t-\w+"', f'class="card t-{r["tier"]}"', c, count=1)
        c = re.sub(r'<span class="rk">#\d+ · [^<]+</span>', f'<span class="rk">#{r["rank"]} · {r["label"]}</span>', c, count=1)
        b = r["b"]
        chip = (f'<p class="qs" title="Composite of cross-sectional percentiles, 0-100. '
                f'Momentum 25%, Trend 15%, Growth 20%, Value 10%, Revisions 20%, Risk 10%.">'
                f'<b>Score {r["score"]:.0f}</b> · Mom {b["momentum"]:.0f} · Trend {b["trend"]:.0f} · '
                f'Growth {b["growth"]:.0f} · Value {b["value"]:.0f} · Rev {b["revision"]:.0f} · Risk {b["risk"]:.0f}</p>')
        c = re.sub(r'<p class="qs".*?</p>', "", c, flags=re.S)
        c = c.replace('<p class="why">', chip + '<p class="why">', 1)
        out.append(c)
    src = src[:first] + sep.join(out) + src[last:]
    d = date.fromisoformat(rows[0]["date"])
    asof = d.strftime("%b ") + str(d.day) + d.strftime(", %Y")
    src = re.sub(r'<p class="sub">Ranked by Claude as of [^<]*</p>',
                 f'<p class="sub">Ranked by Claude as of {asof} with a six-factor quant score (0–100): '
                 f'momentum 25%, trend 15%, growth &amp; quality 20%, value 10%, analyst revisions 20%, risk 10%. '
                 f'Each factor is a percentile against the other {len(rows) - 1} stocks, so the order moves when the data does. '
                 f'<a href="data/ranking.json">Full factor table</a>. Not advice.</p>', src, count=1)
    if ".qs{" not in src:
        src = src.replace(".rank-h{margin-top:4px}",
                          ".rank-h{margin-top:4px}\n.card .qs{font-size:11.5px;margin:6px 0 0;opacity:.8;font-variant-numeric:tabular-nums}", 1)
    p.write_text(src)


if __name__ == "__main__":
    if "--backtest" in ARGS:
        backtest()
        sys.exit()
    rows = score(ASOF)
    keep = ["sym", "date", "rank", "score", "label", "b", "m12", "m6", "m3", "t50", "t200", "slope50", "hi52",
            "rev_g", "op_m", "fcf_m", "ey", "g_per_pe", "breadth", "tgtchg", "drift", "rating", "earn", "upside",
            "vol60", "dd3m", "iv", "_n30", "_up", "_dn"]
    rnd = lambda v: round(v, 4) if isinstance(v, float) else v
    if not ASOF:
        (ROOT / "data/ranking.json").write_text(json.dumps(
            {"asof": rows[0]["date"], "weights": WEIGHTS, "tiers": {l: th for th, _, l in TIERS},
             "rows": [{k: rnd(r.get(k)) for k in keep} for r in rows]}, indent=1))
    for r in rows:
        b = r["b"]
        print(f'{r["rank"]:>2} {r["sym"]:<5} {r["score"]:5.1f} {r["label"]:<12} mom {b["momentum"]:4.0f} trd {b["trend"]:4.0f} '
              f'gro {b["growth"]:4.0f} val {b["value"]:4.0f} rev {b["revision"]:4.0f} rsk {b["risk"]:4.0f}')
    if "--apply" in ARGS:
        apply(rows)
        print("index.html reordered")
