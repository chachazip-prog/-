#!/usr/bin/env python3
"""T-166 원본 갱신(결정적, 다시 돌려도 같은 파일). D-120 / design/tour-destinations-proposal.md §6-1.

  python3 art/tools/t166_src.py

1. art/src/sprites/t166-icons.json (flat, ui 그룹, 12x12): 순회 출발 아이콘 3종
   icon_tour_board  줄 그어진 흰 판(진한 청록·초록 마커 줄) + 받침대의 마커 + 벌어진 이젤 다리(모니터와 구분)
   icon_tour_water  파란(셔츠 파랑) 물방울. 김 나는 하늘색 네모 머그 icon_tour_cup 과 실루엣·색 모두 다름
   icon_tour_memo   노란 정사각 메모지 + 오른쪽 아래 접힌 귀퉁이 + 갈색 낙서 줄. 황갈 결재판 icon_tour_report 와 색·모양 다름
2. art/src/sprites/t166-tile.json (prefix tile2, 16x16): 옆 벽(tile/wall_cap_l·_r 자리) 장식
   wall_whiteboard_side_l / _r  주간 일정판(흰 판 + 하늘색 머리 칸 + 색 막대, 읽히는 글자 없음) + 아래 마커 받침
   wall_water_side_l / _r       벽걸이 작은 정수기(위 하늘색 물통, 냉 하늘색·온 노랑 버튼, 꼭지 + 물방울, 물받이)
   _r 은 _l 좌우 반전(T-146 wall_blind_side_l/_r 과 같은 방식)
3. art/src/sprites/t166-furn.json (prefix furn2, 16x16, 원점 (0.5, 1)): 메모지 소품(책상 위에 겹쳐 그림)
   desk_memo         furn/desk_monitor 위: 모니터 오른쪽 위 모서리 노란 2x2
   desk_memo_papers  furn/desk_papers 위: 서류 더미 오른쪽 위 노란 2x2
4. char-teamlead.json: 옆모습 대기 wait_side_right_1(+ 반전 wait_side_left_1) 1장만 새로 그리고
   anim teamlead/wait_side_right·_left = idle_<dir> 재사용 0·0·1·0·1 (wait_up 과 같은 리듬, 3fps)
   1 = 결재판 1px 내려감 + 앞발 끝 까딱. 남녀 변형(teamlead_m/_f)은 variantOf 로 자동 생성
5. kit-head-teamlead-f.json: 옆모습 머리 아래 덧그림 대상에 wait_side_right_1 추가(여 변형 어깨 머리 유지)
빨강(point) 없음. 표준 라이브러리만.
"""
import json
import os

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")

ICONS = {
    "name": "t166-icons",
    "group": "ui",
    "flat": True,
    "lean": True,
    "size": [12, 12],
    "note": "T-166 팀 안 순회 목적지 출발 아이콘(layout leadRoaming.destinations[].bubbleIcon, D-120). 글자·로고·빨강 없음. 8px 축소 비교: art/preview/t166-icons.png",
    "frames": [
        {"name": "icon_tour_board", "rows": [
            "............",
            "OOOOOOOOOOOO",
            "OWWWWWWWWWWO",
            "OWcccWWgWWWO",
            "OWWWWWWWWWWO",
            "OWgggWcccWWO",
            "OWWWWWWWWWWO",
            "OWccWWWWWWWO",
            "OOOOOOOOOOOO",
            ".OMDCCMMMMO.",
            "..OO....OO..",
            ".OO......OO.",
        ]},
        {"name": "icon_tour_water", "rows": [
            ".....OO.....",
            "....OPPO....",
            "....OPPO....",
            "...OPPPPO...",
            "...OWPPPO...",
            "..OPWPPPPO..",
            "..OWPPPPPO..",
            ".OPWPPPPPPO.",
            ".OPPPPPPPPO.",
            ".OPPPPPPpPO.",
            "..OpPPPppO..",
            "...OOOOOO...",
        ]},
        {"name": "icon_tour_memo", "rows": [
            "............",
            ".OOOOOOOOOO.",
            ".OYYYYYYYYO.",
            ".OYttttttYO.",
            ".OYYYYYYYYO.",
            ".OYttttYYYO.",
            ".OYYYYYYYYO.",
            ".OYtttYOOOO.",
            ".OYYYYYOTO..",
            ".OYYYYYOO...",
            ".OOOOOOO....",
            "............",
        ]},
    ],
}

TILE = {
    "name": "t166-tile",
    "prefix": "tile2",
    "group": "tile",
    "size": [16, 16],
    "note": "T-166 옆 벽 장식(D-120): 팀 모듈 바깥 벽(tile/wall_cap_l·_r 자리)에 그리는 그림 장식, 통행·시선 판정 없음. _l = 왼쪽 벽, _r = 좌우 반전. 화이트보드 = 주간 일정판(글자 없음), 정수기 = 벽걸이 소형(T-143 tall2/purifier 와 같은 냉 하늘색·온 노랑 버튼)",
    "frames": [
        {"name": "wall_whiteboard_side_l", "rows": [
            "DDDDDDDDDDDDMLO.",
            "DDOOOOOOOOODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOCWCCCWWODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOCWGGWWWODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOCWCCCCWODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOCWWGWWWODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOCWYYYWWODMLO.",
            "DDOCWWWWWWODMLO.",
            "DDOOOOOOOOODMLO.",
            "DDDOMMDCCMODMLO.",
            "DDDOOOOOOOODMLO.",
        ]},
        {"name": "wall_whiteboard_side_r", "flip": "wall_whiteboard_side_l"},
        {"name": "wall_water_side_l", "rows": [
            "DDDDDDDDDDDDMLO.",
            "DDDDDOOODDDDMLO.",
            "DDDDOCWCODDDMLO.",
            "DDDDOCCcODDDMLO.",
            "DDDOOOOOOODDMLO.",
            "DDDOWWWWLODDMLO.",
            "DDDOWCWYLODDMLO.",
            "DDDOWWWWLODDMLO.",
            "DDDOWOOOLODDMLO.",
            "DDDOWOMOLODDMLO.",
            "DDDOWOCOLODDMLO.",
            "DDDOWOMOLODDMLO.",
            "DDDOLOOOLODDMLO.",
            "DDDOLLLLLODDMLO.",
            "DDDOOOOOOODDMLO.",
            "DDDDDDDDDDDDMLO.",
        ]},
        {"name": "wall_water_side_r", "flip": "wall_water_side_l"},
    ],
}

FURN = {
    "name": "t166-furn",
    "prefix": "furn2",
    "group": "furniture",
    "size": [16, 16],
    "origin": [0.5, 1],
    "note": "T-166 메모지 소품(D-120 desk_memo 목적지): 책상과 같은 자리·같은 원점에 책상 바로 위 깊이로 겹쳐 그림. desk_memo = furn/desk_monitor 용(모니터 오른쪽 위 모서리), desk_memo_papers = furn/desk_papers 용(서류 더미 오른쪽 위). 나머지는 투명",
    "frames": [
        {"name": "desk_memo", "rows": ["." * 16] + ["...........YY..."] * 2 + ["." * 16] * 13},
        {"name": "desk_memo_papers", "rows": ["." * 16] * 9 + ["......YY........"] * 2 + ["." * 16] * 5},
    ],
}

WAIT_STAMPS = [
    {"frames": ["wait_side_right_1"], "x": 3, "y": 12,
     "_note": "T-166 결재판 1px 내려감(맨 윗줄은 원래 몸통 OPPP 복원)",
     "rows": ["OPPP", "OOOO", "OWtO", "OWtO", "OWtO", "OOOO"]},
    {"frames": ["wait_side_right_1"], "x": 4, "y": 18,
     "_note": "T-166 앞발 끝 까딱(발끝 1px 들림)",
     "rows": ["ODDDDDOO", "OOOOOO__"]},
]
WAIT_FRAMES = [
    {"name": "wait_side_right_1", "from": "idle_right"},
    {"name": "wait_side_left_1", "flip": "wait_side_right_1"},
]
WAIT_ANIMS = [
    {"key": "wait_side_right", "frames": ["idle_right", "idle_right", "wait_side_right_1", "idle_right", "wait_side_right_1"],
     "frameRate": 3, "repeat": -1},
    {"key": "wait_side_left", "frames": ["idle_left", "idle_left", "wait_side_left_1", "idle_left", "wait_side_left_1"],
     "frameRate": 3, "repeat": -1},
]
NOTE_ADD = " T-166: 옆모습 대기 wait_side_right·_left(화이트보드·정수기 앞, idle_<dir> 재사용 + _1 = 결재판 1px 내려감 + 발끝 까딱)"


def write(fn, d):
    p = os.path.join(SPR, fn)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("write", fn)


def replace_named(lst, new, key):
    names = {x[key] for x in new}
    return [x for x in lst if x.get(key) not in names] + new


def main():
    for d in (ICONS, TILE, FURN):
        for f in d["frames"]:
            if "rows" in f:
                assert len(f["rows"]) == d["size"][1] and all(len(r) == d["size"][0] for r in f["rows"]), f["name"]
    write("t166-icons.json", ICONS)
    write("t166-tile.json", TILE)
    write("t166-furn.json", FURN)

    p = os.path.join(SPR, "char-teamlead.json")
    d = json.load(open(p, encoding="utf-8"))
    d["stamps"] = [s for s in d["stamps"] if s.get("frames") != ["wait_side_right_1"]] + WAIT_STAMPS
    d["frames"] = replace_named(d["frames"], WAIT_FRAMES, "name")
    d["anims"] = replace_named(d["anims"], WAIT_ANIMS, "key")
    d["note"] = d["note"].split(" T-166:")[0] + NOTE_ADD
    write("char-teamlead.json", d)

    p = os.path.join(SPR, "kit-head-teamlead-f.json")
    d = json.load(open(p, encoding="utf-8"))
    for s in d["stamps"]:
        fr = s.get("frames")
        if fr and "idle_right" in fr and "wait_side_right_1" not in fr:
            fr.append("wait_side_right_1")
    write("kit-head-teamlead-f.json", d)


if __name__ == "__main__":
    main()
