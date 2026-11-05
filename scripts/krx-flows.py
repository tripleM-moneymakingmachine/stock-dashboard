"""KRX KOSPI investor net buying and turnover for the FX tab's USD/KRW flow signal (scripts/fetch-krw-flows.mjs).

KRX's data marketplace has required a member login since Dec 27, 2025, so this uses pykrx, which logs in with the
KRX_ID / KRX_PW environment variables (GitHub Actions secrets). Writes data/.krx-flows.tmp.json (not committed):
  {"flows": [[date, foreign, retail, institutions, pension], ...] in KRW tn, "turnover": [[date, KRW tn], ...]}
Usage: python3 scripts/krx-flows.py FROM TO   (YYYY-MM-DD)
"""
import json, os, sys, time

OUT = "data/.krx-flows.tmp.json"
if not (os.environ.get("KRX_ID") and os.environ.get("KRX_PW")):
    print("KRX_ID / KRX_PW not set: skipping KRX investor flows (add them as repository secrets)")
    sys.exit(0)
from pykrx import stock  # noqa: E402

fr, to = sys.argv[1].replace("-", ""), sys.argv[2].replace("-", "")
flows, tv = [], []
y0, y1 = int(fr[:4]), int(to[:4])
for y in range(y0, y1 + 1):
    a = fr if y == y0 else f"{y}0101"
    b = to if y == y1 else f"{y}1231"
    df = stock.get_market_trading_value_by_date(a, b, "KOSPI", detail=True)  # net buy (순매수), KRW
    if y == y0:
        print("KRX columns:", list(df.columns))
    cols = {c: c for c in df.columns}
    g = lambda r, k: float(r[k]) if k in cols else 0.0
    inst = ["금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금"]
    for d, r in df.iterrows():
        tn = lambda x: round(x / 1e12, 4)
        flows.append([d.strftime("%Y-%m-%d"), tn(g(r, "외국인") + g(r, "기타외국인")), tn(g(r, "개인")), tn(sum(g(r, k) for k in inst)), tn(g(r, "연기금"))])
    time.sleep(1)
    ix = stock.get_index_ohlcv(a, b, "1001")  # KOSPI; 거래대금 in KRW
    for d, r in ix.iterrows():
        if "거래대금" in ix.columns and r["거래대금"] > 0:
            tv.append([d.strftime("%Y-%m-%d"), round(float(r["거래대금"]) / 1e12, 3)])
    print(f"KRX {a}..{b}: {len(df)} flow days, {len(ix)} index days")
    time.sleep(1)
json.dump({"flows": flows, "turnover": tv}, open(OUT, "w"))
print(f"wrote {OUT}: {len(flows)} flow days, last {flows[-1] if flows else None}")
