"""한국사 지식 베이스의 연도별 사건표(yearly.csv)와 현황(coverage.md)을 만든다.

입력: eras.json, rulers.csv, events/*.csv
출력: yearly.csv, coverage.md

연도마다 다음 순서로 3개 이상을 채운다.
1. 기록: events/*.csv 에서 그해 사건
2. 정세: rulers.csv 에서 그해 각 나라의 왕·정부와 재위 연차
3. 생활상: 부족하면 eras.json 의 시대 생활 사건 풀에서 해마다 다르게 골라 채움
"""
import csv
import glob
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START, END, MIN_PER_YEAR = -1000, 2026, 3
EVENT_COLS = ["year", "title", "summary", "category", "region", "people", "keywords", "confidence"]
CONFIDENCE = {"확실", "통설", "전승", "추정", "검증필요"}
STEM, BRANCH = "갑을병정무기경신임계", "자축인묘진사오미신유술해"


def idx(y):
    """서기 0년이 없으므로 연도를 연속된 정수로 바꾼다(기원전 1년 = 0)."""
    return y + 1 if y < 0 else y


def ganji(y):
    i = (idx(y) - 4) % 60
    return STEM[i % 10] + BRANCH[i % 12]


def label(y):
    return f"기원전 {-y}년" if y < 0 else f"{y}년"


def load_events():
    rows, errors = [], []
    for path in sorted(glob.glob(os.path.join(ROOT, "events", "*.csv"))):
        name = os.path.basename(path)
        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            if header != EVENT_COLS:
                errors.append(f"{name}: 머리글이 다름 {header}")
                continue
            for n, row in enumerate(reader, start=2):
                if not row:
                    continue
                if len(row) != len(EVENT_COLS):
                    errors.append(f"{name}:{n} 열 개수 {len(row)} (쉼표가 들어갔는지 확인)")
                    continue
                r = dict(zip(EVENT_COLS, row))
                try:
                    r["year"] = int(r["year"])
                except ValueError:
                    errors.append(f"{name}:{n} 연도가 숫자가 아님 {r['year']}")
                    continue
                if r["year"] == 0 or not START <= r["year"] <= END:
                    errors.append(f"{name}:{n} 범위를 벗어난 연도 {r['year']}")
                if r["confidence"] not in CONFIDENCE:
                    errors.append(f"{name}:{n} 신뢰도 값 {r['confidence']}")
                r["file"] = name
                rows.append(r)
    return rows, errors


def load_rulers():
    with open(os.path.join(ROOT, "rulers.csv"), encoding="utf-8", newline="") as f:
        out = []
        for r in csv.DictReader(f):
            r["start"], r["end"] = int(r["start"]), int(r["end"])
            out.append(r)
        return out


def politics(y, rulers):
    """그해 나라별 통치자. 한 해에 왕이 바뀌면 새 왕을 쓰고 즉위로 표시한다."""
    by_polity = {}
    for r in rulers:
        if r["start"] <= y <= r["end"]:
            cur = by_polity.get(r["polity"])
            if cur is None or r["start"] > cur["start"]:
                by_polity[r["polity"]] = r
    parts, conf = [], []
    for polity, r in by_polity.items():
        # 삼국·발해(『삼국사기』)는 즉위한 해가 원년(즉위년칭원), 고려·조선은 즉위 이듬해가 원년(유년칭원)
        yunyeon = r["polity"] in {"고려", "조선", "조선·대한제국", "대한제국"}
        n = idx(y) - idx(r["start"]) + (0 if yunyeon else 1)
        dynastic = yunyeon or r["polity"] in {"고구려", "백제", "신라", "발해", "후백제", "후고구려·마진·태봉"}
        if dynastic:
            if yunyeon:
                parts.append(f"{polity} {r['ruler']} {'즉위년' if n == 0 else f'{n}년'}")
            else:
                parts.append(f"{polity} {r['ruler']} {'원년(즉위)' if n == 1 else f'{n}년'}")
        else:
            parts.append(f"{polity}: {r['ruler']}")
        conf.append(r["confidence"])
    rank = ["검증필요", "추정", "전승", "통설", "확실"]
    worst = min(conf, key=rank.index) if conf else "추정"
    return " · ".join(parts), worst


def main():
    eras = json.load(open(os.path.join(ROOT, "eras.json"), encoding="utf-8"))
    rulers = load_rulers()
    events, errors = load_events()
    if errors:
        print("데이터 오류:")
        for e in errors:
            print("  -", e)
        sys.exit(1)

    by_year = defaultdict(list)
    for e in events:
        by_year[e["year"]].append(e)

    def era_of(y):
        for era in eras:
            if era["start"] <= y <= era["end"]:
                return era
        raise ValueError(y)

    out_rows, stats = [], defaultdict(lambda: {"years": 0, "with_record": 0, "records": 0, "three_records": 0})
    for y in range(START, END + 1):
        if y == 0:
            continue
        era = era_of(y)
        rows = []
        for e in by_year.get(y, []):
            rows.append({"kind": "기록", "title": e["title"], "summary": e["summary"], "category": e["category"],
                         "region": e["region"], "people": e["people"], "confidence": e["confidence"]})
        summary, conf = politics(y, rulers)
        rows.append({"kind": "정세", "title": "그해의 나라와 임금·정부", "summary": summary, "category": "정치",
                     "region": "", "people": "", "confidence": conf})
        pool = era["life_events"]
        k = 0
        while len(rows) < MIN_PER_YEAR:
            season, title, text = pool[(idx(y) * 7 + k * 5) % len(pool)]
            k += 1
            if any(r["title"] == title for r in rows):
                continue
            rows.append({"kind": "생활상", "title": title, "summary": f"[{season}] {text}", "category": "생활",
                         "region": "", "people": "", "confidence": "시대 생활상"})
        for r in rows:
            out_rows.append({"year": y, "year_label": f"{label(y)}({ganji(y)})", "era": era["name"], **r})
        s = stats[era["id"]]
        s["years"] += 1
        nrec = len(by_year.get(y, []))
        s["records"] += nrec
        s["with_record"] += 1 if nrec else 0
        s["three_records"] += 1 if nrec >= 3 else 0

    cols = ["year", "year_label", "era", "kind", "title", "summary", "category", "region", "people", "confidence"]
    with open(os.path.join(ROOT, "yearly.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(out_rows)

    years = sorted({r["year"] for r in out_rows})
    per_year = defaultdict(int)
    for r in out_rows:
        per_year[r["year"]] += 1
    assert len(years) == 3026, len(years)
    assert min(per_year.values()) >= MIN_PER_YEAR

    conf_count = defaultdict(int)
    for e in events:
        conf_count[e["confidence"]] += 1
    lines = [
        "# 지식 베이스 현황",
        "",
        "`tools/build_yearly.py`가 만든 파일이다. 직접 고치지 말고 데이터를 고친 뒤 다시 실행한다.",
        "",
        "## 전체",
        "",
        f"- 연도 수: {len(years):,}개 (기원전 1000년~2026년, 서기 0년 없음)",
        f"- 연도별 사건 수: 최소 {min(per_year.values())}개, 전체 {len(out_rows):,}개",
        f"- 기록 사건: {len(events):,}개 / 기록이 1개 이상인 연도 {sum(1 for y in years if by_year.get(y)):,}개",
        "- 기록 사건 신뢰도: " + " · ".join(f"{k} {conf_count[k]}" for k in ["확실", "통설", "전승", "추정", "검증필요"]),
        "",
        "## 시대별",
        "",
        "| 시대 | 기간 | 연도 | 기록 있는 연도 | 기록 3개 이상 연도 | 기록 사건 | 나머지 채움 |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for era in eras:
        s = stats[era["id"]]
        pct = s["with_record"] / s["years"] * 100
        lines.append(f"| {era['id']} {era['name']} | {label(era['start'])}~{label(era['end'])} | {s['years']} | "
                     f"{s['with_record']} ({pct:.0f}%) | {s['three_records']} | {s['records']} | 정세 + 생활상 |")
    lines += ["", "## 검증필요 항목", ""]
    for e in events:
        if e["confidence"] == "검증필요":
            lines.append(f"- {label(e['year'])} {e['title']} ({e['file']})")
    lines += ["", "## 읽는 법", "",
              "- 기록이 없는 연도는 ‘정세’와 ‘생활상’으로 채워진다. 생활상은 그 시대에 흔히 있던 일이며 그해의 사실이 아니다.",
              "- 고대(기원전 1000년~기원전 4세기)는 연도 단위 기록이 거의 없어 대부분 생활상으로 채워진다.",
              "- 기록 비율을 높이려면 `events/`에 사료로 확인한 사건을 더하고 다시 실행한다.", ""]
    with open(os.path.join(ROOT, "coverage.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"yearly.csv {len(out_rows):,}행 · 연도 {len(years):,}개 · 기록 {len(events):,}개")


if __name__ == "__main__":
    main()
