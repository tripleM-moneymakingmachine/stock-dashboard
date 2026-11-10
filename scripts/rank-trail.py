#!/usr/bin/env python3
"""Write each card's recent rank trail (e.g. "1→2→1") next to its name on index.html.

The trail is the stock's rank in the last N rankings, oldest first, ending with the
ranking now in index.html. Earlier rankings come from the git history of index.html
(commits whose subject starts "Re-rank main page as of"), so run it after reordering
the cards and before committing. Needs enough history: `git fetch --deepen=200` on a
shallow clone. Usage: python3 scripts/rank-trail.py [--n 3]
"""
import re, subprocess, sys, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 3

CARD = re.compile(r'<a class="card t-\w+" href="(\w+)/".*?<span class="rk">#(\d+) ·')
ASOF = re.compile(r'Ranked by Claude as of ([A-Z][a-z]{2} \d+, \d{4})')


def ranks(src):
    return {t: int(r) for t, r in CARD.findall(src)}


def git(*a):
    return subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True, check=True).stdout


cur = (ROOT / "index.html").read_text()
m = ASOF.search(cur)
snaps = [(m.group(1) if m else "now", ranks(cur))]
seen = {snaps[0][0]}
for line in git("log", "--format=%H %s", "HEAD", "--", "index.html").splitlines():
    sha, subj = line.split(" ", 1)
    if not subj.startswith("Re-rank main page as of"):
        continue
    src = git("show", f"{sha}:index.html")
    a = ASOF.search(src)
    date = a.group(1) if a else sha[:7]
    if date in seen:  # same session re-ranked twice: keep the latest
        continue
    seen.add(date)
    snaps.append((date, ranks(src)))
    if len(snaps) >= N:
        break
snaps.reverse()  # oldest first
if len(snaps) < N:
    print(f"warning: only {len(snaps)} rankings found (shallow clone? try git fetch --deepen=200)")

dates = [d.rsplit(",", 1)[0] for d, _ in snaps]


def trail(t):
    rs = [r.get(t) for _, r in snaps]
    txt = '<i class="ar">→</i>'.join(str(x) if x else "–" for x in rs)
    prev, now = (rs[-2], rs[-1]) if len(rs) > 1 else (None, rs[-1])
    cls = "same" if not prev or prev == now else ("up" if now < prev else "down")
    title = "Rank on " + ", ".join(f"{d}: {x if x else 'not ranked'}" for d, x in zip(dates, rs))
    return f'<span class="trail {cls}" title="{html.escape(title)}">{txt}</span>'


def fix(mo):
    line = mo.group(0)
    t = re.search(r'href="(\w+)/"', line).group(1)
    line = re.sub(r' ?<span class="trail[^"]*"[^>]*>.*?</span>', "", line)
    return re.sub(r'(<div class="name">[^<]*)(</div>)', lambda n: n.group(1) + " " + trail(t) + n.group(2), line, count=1)


out, k = re.subn(r'^\s*<a class="card t-\w+" href="\w+/".*$', fix, cur, flags=re.M)
(ROOT / "index.html").write_text(out)
print(f"trails over {', '.join(dates)} written to {k} cards")
