#!/usr/bin/env python3
"""T-149 원본 부트스트랩: 남녀 변형(D-087·D-088·D-093), 성별 시설 타일, 같은/다른 성별 표식, 캐릭터 선택 초상.

  python3 art/tools/t149_src.py [--force]

쓰는 파일(art/src/sprites/, 이미 있으면 --force 없이 건너뜀. 원본은 JSON 이며 오너 보정 후에는 다시 돌리지 않음)
  kit-head-<variant>.json   새 머리 키트 13종(clear 머리 스탬프 + 앉은 프레임 match + 위장·들킴 머리)
  char-<role>-m.json / -f.json  변형 26종(variantOf 원본 + headKit 또는 kitsReplace)
  kit-carry-b.json          바디 B용 들고 걷기 키트(kit-carry 와 프레임·애니메이션 이름 같음)
  t149-tile.json            tile2/wall_door_restroom_<m|f>_<mine|other>, tile2/floor_locker, tile2/wall_locker
  t149-shower.json          tile2/shower_stall, tile2/shower_stall_hiding (16x24, 닫힌 문 + 사용 중 표시만)
  t149-mark12.json / t149-mark8.json  mark/gender_same, mark/gender_other (12x12) / _s (8x8)
  t149-charsel.json         ui/charsel_card, ui/charsel_card_on (40x52, 남녀 공용)
  t149-portrait.json        ui/charsel_portrait_m, _f (32x40) — player_m/f idle_down 을 2배로 옮긴 격자(같은 포즈)
표준 라이브러리만 사용. 결정적(같은 입력 → 같은 파일).
"""
import argparse
import json
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")
sys.path.insert(0, os.path.join(ART, "tools"))

# ---------------------------------------------------------------- 머리 키트 (각 11행: 0~10)
# 바디 A 얼굴: 눈 x5·x10(정면 7~8행), 옆모습 눈 x11. 바디 B 도 같은 눈 위치라 기존 포즈 스탬프(감은 눈 등)가 그대로 맞는다.

HEADS = {}

# 플레이어 여: 단발 + 플레이어 표지 '정수리 갈고리 삐침'과 왼쪽 옆머리 삐침 유지(D-041 판독)
HEADS["player_f"] = dict(body="A", note="플레이어 여 변형: 턱선 단발 + 정수리 갈고리 삐침·옆머리 삐침(플레이어 표지) 유지", down=[
    "......O..OOO....",
    ".....OOOOHHO....",
    "...OOHHHHHHOO...",
    "..OHHHDDHHHHHO..",
    "OHHHHDHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSHSSSSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OOOOOssssOOOOO.",
], up=[
    "....OOO..O......",
    "....OHHOOOO.....",
    "...OOHHHHHHOO...",
    "..OHHHHHHDDHHO..",
    ".OHHHHHHHHHDHHHO",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    "..OOOOOOOOOOOO..",
], right=[
    "......OOO.......",
    "....OOHHOO......",
    "...OHHHHHHOO....",
    "..OHHHHHDDHHO...",
    "OHHHHHHHHHHDHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSHSSO..",
    ".OHHHHHHSSSOSO..",
    ".OHHHHHHsSSOSO..",
    ".OHHHHHHSSSSSO..",
    ".OOOOOOsssOOO...",
], extra=[
    {"frames": ["disguise"], "clear": True, "x": 0, "y": 0, "_note": "위장(서류로 얼굴 아래 가림): 머리 0~7행만", "rows": [
        "......O..OOO....",
        ".....OOOOHHO....",
        "...OOHHHHHHOO...",
        "..OHHHDDHHHHHO..",
        "OHHHHDHHHHHHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHSSSHSSSSHHO.",
        ".OHHSSOSSSSOHHO.",
    ]},
    {"frames": ["caught"], "clear": True, "x": 0, "y": 0, "_note": "들킴: 머리카락 곤두섬 + 흰자 눈 + 벌린 입(손은 원본 그대로)", "rows": [
        "...O..O..OOO.O..",
        "....OOOOOHHOO...",
        "...OOHHHHHHOO...",
        "..OHHHDDHHHHHO..",
        "OHHHHDHHHHHHHHO.",
        ".OHHHHHHHHHHHHO.",
        ".OHHSSSHSSSSHHO.",
        ".OHHWWSSSSWWHHO.",
        ".OHHWOSSSSOWHHO.",
        ".OHHSSSOOSSSHHO.",
        "OOOOOOssssOOOOOO",
    ]},
])

# 선배 여: 구름 머리를 어깨 위까지 부풀린 단발(볼터치·웃는 눈은 선배 표지라 남녀 같음)
HEADS["senior_f"] = dict(body="A", note="선배 여 변형: 구름 머리 단발(옆이 부풀어 9행까지). 웃는 눈 ^ ^·볼터치는 선배 표지라 남녀 동일", down=[
    ".....OO..OO.....",
    "...OOHHOOHHOO...",
    "..OHHHHHHHHHHO..",
    ".OHHDHHHHDHHHHO.",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    "OHHHSSSSSSSSHHHO",
    "OHHSSOSSSSOSSHHO",
    "OHHSOSOSSOSOSHHO",
    "OHHsSSSssSSSsHHO",
    ".OOOOOssssOOOOO.",
], up=[
    ".....OO..OO.....",
    "...OOHHOOHHOO...",
    "..OHHHHHHHHHHO..",
    ".OHHHHHDHHHHDHO.",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO",
    ".OOOOOOOOOOOOOO.",
], right=[
    "....OO..OO......",
    "..OOHHOOHHOO....",
    ".OHHHHHHHHHHO...",
    "OHHDHHHHHDHHHO..",
    "OHHHHHHHHHHHHO..",
    "OHHHHHHHHHHHHO..",
    "OHHHHHHHHSSSSO..",
    "OHHHHHHSSSSOSO..",
    "OHHHHHHsSOSOSO..",
    "OHHHHHHSSsSSSO..",
    ".OOOOOOsssOOO...",
])

# 공범 여: 초록 헤드폰(공범 표지) + 높이 묶은 포니테일
HEADS["accomplice_f"] = dict(body="A", note="공범 여 변형: 초록 헤드폰 유지 + 높이 묶은 포니테일(정면 오른쪽 위로 삐져나옴, 뒷모습 가운데로 늘어짐(짙은 회남색 D 결 + 회색 끈), 옆모습 뒤로)", down=[
    "................",
    ".....OOOOOO..OO.",
    "...OOGGGGGGOOHHO",
    "..OGHHHDDHHHGOHO",
    ".OGHHHHHHHHHHGOO",
    "OGGOHHHHHHHHOGGO",
    "OGgOSSSSSSSSOgGO",
    "OGgSSOSSSSSSSgGO",
    ".OOSSOSSSOOSSOO.",
    "..OSSSSssSSSSO..",
    "...OOOssssOOO...",
], up=[
    "................",
    ".....OOOOOO.....",
    "...OOGGGGGGOO...",
    "..OGHHHHHHHHGO..",
    ".OGHHHHMMHHHHGO.",
    "OGGOHHHDDHHHOGGO",
    "OGgOHHHDDHHHOgGO",
    "OGgOHHHDDHHHOgGO",
    ".OOSHHHDDHHHSOO.",
    "..OHHHODDOHHHO..",
    "...OOOOHHOOOO...",
], right=[
    "................",
    "....OOOOOO......",
    "OOOMHHGGHHOO....",
    "OHOHHHGGHDDHO...",
    "OHOHHHGGHHHDHO..",
    "OHOHOOOOOHHHHO..",
    ".OHHOGGgOHSSSO..",
    ".OHHOGGgOSSOSO..",
    ".OHHHOOOsSSOSO..",
    "..OHHHHSSSSSSO..",
    "...OOOOsssOOO...",
])

# 인사팀 여: 가운데 가르마 짧은 커트(귀가 보임) — 남 변형(원본)은 커튼 앞머리 중간 길이
HEADS["hr_f"] = dict(body="A", note="인사팀 여 변형: 가운데 가르마 짧은 커트(귀·목선이 보임). 남 변형(원본)이 더 긴 커튼 앞머리", down=[
    "................",
    ".....OOOOOO.....",
    "...OOHHMHHHOO...",
    "..OHHHHMHHHHHO..",
    ".OHHHHMHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OSSSOSSSSOSSSO.",
    ".OSSSOSSSSOSSSO.",
    "..OSSSSssSSSSO..",
    "...OOOssssOOO...",
], up=[
    "................",
    ".....OOOOOO.....",
    "...OOHHHMHHOO...",
    "..OHHHHHMHHHHO..",
    ".OHHHHHHMHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OSHHHHHHHHHHSO.",
    ".OSHHHHHHHHHHSO.",
    "..OSSHHHHHHSSO..",
    "...OOOssssOOO...",
], right=[
    "................",
    "....OOOOOO......",
    "...OHHHHHHOO....",
    "..OHHHHHHMHHO...",
    ".OHHHHHHHHMHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHSSSSSO..",
    ".OHHHSSSSSSOSO..",
    ".OHHHSsSSSSOSO..",
    "..OHHSSSSSSSSO..",
    "...OOOOsssOOO...",
])

# 배경 동료 A 여: 옆 가르마 단발(앞머리가 한쪽 이마를 덮음)
HEADS["bg_a_f"] = dict(body="A", note="배경 동료 A 여 변형: 옆 가르마 단발(한쪽으로 넘긴 앞머리)", sit=["sit_type_*", "sit_stretch_*"], down=[
    "................",
    ".....OOOOOO.....",
    "...OOHHHMHHOO...",
    "..OHHHHHMHHHHO..",
    ".OHHHHHHHMHHHHO.",
    ".OHHHHHHHHMHHHO.",
    ".OHHSSSSSHHHHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OOOOOssssOOOOO.",
], up=[
    "................",
    ".....OOOOOO.....",
    "...OOHHMHHHOO...",
    "..OHHHHMHHHHHO..",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    "..OOOOOOOOOOOO..",
], right=[
    "................",
    "....OOOOOO......",
    "...OHHHHHHOO....",
    "..OHHHHHMHHHO...",
    ".OHHHHHHHMHHHO..",
    ".OHHHHHHHHMHHO..",
    ".OHHHHHHHHHSSO..",
    ".OHHHHHHSSSOSO..",
    ".OHHHHHHsSSOSO..",
    ".OHHHHHHSSSSSO..",
    ".OOOOOOsssOOO...",
])

# 배경 동료 C 여: 정수리 똥머리(이마를 드러낸 올림머리). 목 뒤 후드는 원본 스탬프 그대로
HEADS["bg_c_f"] = dict(body="A", note="배경 동료 C 여 변형: 정수리 똥머리 올림머리(앞머리 없음). 목 뒤 후드는 남녀 같음", sit=["sit_type_*"], down=[
    ".....OOOOOO.....",
    ".....OHHMHO.....",
    "...OOOHHHHOOO...",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OSSSOSSSSOSSSO.",
    "..OSSSSssSSSSO..",
    "...OOOssssOOO...",
], up=[
    ".....OOOOOO.....",
    ".....OHHMHO.....",
    "...OOOHHHHOOO...",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OSHHHHHHHHHHSO.",
    "..OHHHHHHHHHHO..",
    "...OOOssssOOO...",
], right=[
    "...OOOOO........",
    "...OHHMOOO......",
    "...OHHHHHHOO....",
    "..OHHHHHHHHHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHSSSO..",
    ".OHHHHHHSSSSSO..",
    ".OHHHHHSSSSOSO..",
    ".OHHHHHsSSSOSO..",
    "..OHHHHSSSSSSO..",
    "...OOOOsssOOO...",
])

# 팀장 여(1번 팀장): 옆 가르마 단발 + 굵은 눈썹(팀장 표지) — 옆 팀 팀장(남, 원본 짧은 가르마)과 실루엣으로 구분
HEADS["teamlead_f"] = dict(body="B", note="팀장 여 변형(1번 팀장): 볼륨 있는 옆 가르마 단발 + 굵은 눈썹 2px(팀장 표지). 옆 팀 팀장(남 = 원본 짧은 가르마)과 머리 실루엣으로 구분", down=[
    "...OOOOOOOOOO...",
    "..OHHHHMHHHHHO..",
    ".OHHHHHMHHHDDHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSHHHHO.",
    ".OHHHHSSSSHHHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OOOOOssssOOOOO.",
], up=[
    "...OOOOOOOOOO...",
    "..OHHHHHHMHHHO..",
    ".OHHDDHHHMHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    "..OOOOOOOOOOOO..",
], right=[
    "...OOOOOOOO.....",
    "..OHHHHHMHHO....",
    ".OHHHHHHMDDHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSHHHO..",
    ".OHHHHHHSSSOSO..",
    ".OHHHHHHsSSOSO..",
    ".OHHHHHHSSSSSO..",
    ".OOOOOOsssOOO...",
])

# 임원(본부장) 여: 올백(정수리 광택, 임원 표지) + 뒤로 묶은 쪽머리
HEADS["exec_f"] = dict(body="B", note="임원(본부장) 여 변형: 올백 + 정수리 광택(임원 표지) 유지, 뒤로 묶은 쪽머리(뒷모습 가운데 둥근 매듭, 옆모습 뒤통수 혹), 관자놀이 옆머리", down=[
    ".....OOOOOO.....",
    "..OOOHHHHHHOOO..",
    "..OHHHLLLLHHHO..",
    ".OHHHHHHMMHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSOOSSSSOOSHO.",
    ".OHSSSSSSSSSSHO.",
    ".OSSSSSssSSSSSO.",
    "..OOOOssssOOOO..",
], up=[
    "................",
    "..OOOOOOOOOOOO..",
    "..OHHHLLLLHHHO..",
    ".OHHHHMMHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHOOOOHHHHO.",
    ".OHHHOHHHMOHHHO.",
    ".OHHHOHHHHOHHHO.",
    ".OSHHOHHHHOHHSO.",
    ".OHHHHOOOOHHHHO.",
    "..OOOOssssOOOO..",
], right=[
    "................",
    "..OOOOOOOOOO....",
    "..OHHHLLLLHO....",
    ".OHHHHHHMHHHO...",
    "OOHHHHHHHHHHHO..",
    "OHOHHHHHHSSSSO..",
    "OHOHHHHHSSSSSO..",
    "OOHHHHHSSSOOSO..",
    ".OHHHHHsSSSSSO..",
    ".OHHHHHSSSSSSO..",
    "..OOOOOsssOOO...",
])

# 대표님 남: 퐁파두르(대표 표지) + 귀를 덮는 중단발 + 목덜미 짧은 꽁지머리(대표님 여 = 원본 짧은 퐁파두르)
HEADS["ceo_m"] = dict(body="B", note="대표님 남 변형: 퐁파두르(대표 표지, 키 1px 큼) + 귀 덮는 중단발 + 목덜미 짧은 꽁지머리(회색 끈). 대표님 여(원본)는 짧은 퐁파두르", down=[
    "....OOOOOOO.....",
    "..OOHHHHHHHOO...",
    "..OHHHLLHHHHHO..",
    ".OHHHLHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OOOOOssssOOOOO.",
], up=[
    ".....OOOOOOO....",
    "...OOHHHHHHHOO..",
    "..OHHHHHLLHHHO..",
    ".OHHHHHHHHLHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHOOHHHHHO.",
    ".OHHHHOMMOHHHHO.",
    "..OOOOOHHOOOOO..",
], right=[
    ".....OOOOOO.....",
    "...OOHHHHHHOO...",
    "..OHHHHHHLLHHO..",
    ".OHHHHHHHHHLHHO.",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    "OOHHHHHHSSSOSO..",
    "OMHHHHHHsSSOSO..",
    "OHHHHHHHSSSSSO..",
    "OOOOOOOsssOOO...",
])

# 경비 여: 챙 모자(경비 표지, 원본과 같음) + 모자 뒤로 뺀 포니테일
HEADS["guard_f"] = dict(body="B", note="경비 여 변형: 챙 모자(노란 배지) 원본 그대로 + 모자 뒤 구멍으로 뺀 포니테일(회색 끈), 관자놀이 옆머리", down=[
    "...OOOOOOOOOO...",
    "..ODDDDYYDDDDO..",
    ".ODDDDDDDDDDDDO.",
    ".ODDDDDDDDDDDDO.",
    "OOOOOOOOOOOOOOOO",
    ".OHHSSSSSSSSHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OSSSSSssSSSSSO.",
    "..OOOOssssOOOO..",
], up=[
    "...OOOOOOOOOO...",
    "..ODDDDDDDDDDO..",
    ".ODDDDDDDDDDDDO.",
    ".ODDDDDDDDDDDDO.",
    ".OOOOOOOOOOOOOO.",
    ".OHHHHHMMHHHHHO.",
    ".OHHHHHDDHHHHHO.",
    ".OHHHHHDDHHHHHO.",
    ".OSHHHHDDHHHHSO.",
    ".OHHHHODDOHHHHO.",
    "..OOOOOHHOOOOO..",
], right=[
    "..OOOOOOOOO.....",
    "..ODDDDDDYDO....",
    ".ODDDDDDDDDDO...",
    ".ODDDDDDDDDDDO..",
    ".OOOOOOOOOOOOOOO",
    "OMOHHHHHHHHHHO..",
    "OHOHHHHHHSSSSO..",
    "OHOHHHHSSSSOSO..",
    "OHOHHHHsSSSOSO..",
    ".OOHHHHSSSSSSO..",
    "..OOOOOsssOOO...",
])

# 정의로운 동료 여: 옆으로 넘긴 짧은 커트 + 사각 안경(표지) — 남(원본)은 일자 앞머리 바가지
HEADS["snitch_f"] = dict(body="B", note="정의로운 동료 여 변형: 옆으로 넘긴 앞머리 짧은 커트(옆·목선 짧음) + 반짝이는 사각 안경(표지). 남(원본)은 일자 앞머리 바가지", down=[
    "................",
    "..OOOOOOOOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHDDHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHSSSSHO.",
    ".OSHHHSSSSSSSSO.",
    ".OSOCCOOOOCCOSO.",
    ".OSOWCOSSOWCOSO.",
    ".OSSSSSssSSSSSO.",
    "..OOOOssssOOOO..",
], up=[
    "................",
    "..OOOOOOOOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHDDHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OSHHHHHHHHHHSO.",
    ".OSSHHHHHHHHSSO.",
    "..OOOOssssOOOO..",
], right=[
    "................",
    "..OOOOOOOOOO....",
    "..OHHHHHHHHO....",
    ".OHHHHHHDDHHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHSSOOOCCOO..",
    ".OHHHSssSOWCOO..",
    ".OHHHSSSSSSSSO..",
    "..OOOOOsssOOO...",
])

# 배경 동료 B 남: 단발 + 정수리 한 가닥(bg_b 표지) — 여(원본)는 짧은 머리 + 한 가닥
HEADS["bg_b_m"] = dict(body="B", note="배경 동료 B 남 변형: 일자 앞머리 단발 + 정수리 한 가닥(bg_b 표지). 여(원본)는 짧은 머리 + 한 가닥", sit=["sit_type_*"], down=[
    ".......O........",
    "..OOOOOOHOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHDDHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OOOOOssssOOOOO.",
], up=[
    ".......O........",
    "..OOOOOOHOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHDDHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    "..OOOOOOOOOOOO..",
], right=[
    ".......O........",
    "..OOOOOOHOOO....",
    "..OHHHHHHHHO....",
    ".OHHHHHHDDHHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHSSSO..",
    ".OHHHHHHSSSOSO..",
    ".OHHHHHHsSSOSO..",
    ".OHHHHHHSSSSSO..",
    ".OOOOOOsssOOO...",
])

# 옆 팀 동기 남: 끝이 바깥으로 뻗친 웨이브 중단발 + 볼터치·웃음(동기 표지). 여 = 기존 kit-head-buddy(짧은 뽀글)
HEADS["bg_buddy_m"] = dict(body="B", note="옆 팀 동기 남 변형(회전 인물, 여와 같은 비중): 옆 가르마 웨이브 중단발(끝이 바깥으로 뻗침) + 볼터치·웃음(동기 표지). 여 변형은 기존 kit-head-buddy(짧은 뽀글)",
                         sit=["sit_type_*"], sit_down=["sit_turn_*"], down=[
    "....OOOOOOO.....",
    "..OOHHHHHHHOOO..",
    ".OHHHHHHHDDHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHSHHSSSSHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHsOSSSSOsHHO.",
    "OHHHSSSssSSSHHHO",
    ".OOOOOssssOOOOO.",
], up=[
    "....OOOOOOO.....",
    "..OOHHHHHHHOOO..",
    ".OHHHDDHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    "OHHHHHHHHHHHHHHO",
    ".OOOOOOOOOOOOOO.",
], right=[
    "....OOOOOO......",
    "..OOHHHHHHOO....",
    ".OHHHHHHHDDHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHSHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHHHHSSSOSO..",
    ".OHHHHHHsSSOSO..",
    "OHHHHHHHSSSSSO..",
    ".OOOOOOsssOOO...",
], extra=[
    {"match": "sit_turn_1", "x": 0, "y": 7, "_note": "웃음 표정(^ ^ + 벌린 입), 머리 모양에 맞춘 판", "rows": [
        ".OHHSOSSSSOSHHO.",
        ".OHHOSOSSOSOHHO.",
        "OHHHSSSDDSSSHHHO",
        ".OOOOOssssOOOOO.",
    ]},
])

# ---------------------------------------------------------------- 변형 배정 (D-093: 남녀 모두 머리 길이를 섞음)
# (role, 원본 sprite 이름, 파일 접미 기준, m 머리, f 머리). None = 원본 머리 그대로
ROLES = [
    ("player", "player", "char-player", None, "player_f"),
    ("senior", "senior", "char-senior", None, "senior_f"),
    ("teamlead", "teamlead", "char-teamlead", None, "teamlead_f"),
    ("exec", "exec", "char-exec", None, "exec_f"),
    ("ceo", "ceo", "char-ceo", "ceo_m", None),
    ("guard", "guard", "char-guard", None, "guard_f"),
    ("snitch", "snitch", "char-snitch", None, "snitch_f"),
    ("accomplice", "accomplice", "char-accomplice", None, "accomplice_f"),
    ("hr", "hr", "char-hr", None, "hr_f"),
    ("bg_a", "bg_a", "char-bg-a", None, "bg_a_f"),
    ("bg_b", "bg_b", "char-bg-b", "bg_b_m", None),
    ("bg_c", "bg_c", "char-bg-c", None, "bg_c_f"),
    ("bg_buddy", "bg_buddy", "char-buddy", "bg_buddy_m", None),
]
LENGTH = {  # 미리보기·가이드용 머리 길이 분류(S 짧음, M 귀~턱 단발, T 묶음)
    "player_m": "S", "player_f": "M", "senior_m": "S", "senior_f": "M", "teamlead_m": "S", "teamlead_f": "M",
    "exec_m": "S", "exec_f": "T", "ceo_m": "T", "ceo_f": "S", "guard_m": "S", "guard_f": "T",
    "snitch_m": "M", "snitch_f": "S", "accomplice_m": "S", "accomplice_f": "T", "hr_m": "M", "hr_f": "S",
    "bg_a_m": "S", "bg_a_f": "M", "bg_b_m": "M", "bg_b_f": "S", "bg_c_m": "S", "bg_c_f": "T",
    "bg_buddy_m": "M", "bg_buddy_f": "S",
}


def head_kit(vid, h):
    st = []
    for d in ("down", "up", "right"):
        s = {"dir": d, "clear": True, "x": 0, "y": 0, "rows": h[d]}
        m = (h.get("sit", []) if d == "up" else []) + (h.get("sit_down", []) if d == "down" else [])
        if m:
            s["match"] = m
        st.append(s)
    st += h.get("extra", [])
    return {"name": "kit-head-" + vid.replace("_", "-"), "kit": True,
            "note": "T-149 머리 키트(바디 %s): %s. D-093: 머리 모양·실루엣만 바꿈(체형·피부·옷·소품·줄 색은 역할 원본과 같음)" % (h["body"], h["note"]),
            "stamps": st}


# ---------------------------------------------------------------- kit-carry-b (바디 B 좌표)

def kit_carry_b():
    k = json.load(open(os.path.join(SPR, "kit-carry.json"), encoding="utf-8"))
    out = []
    for st in k["stamps"]:
        st = dict(st)
        m = st["match"]
        key = json.dumps(m)
        x, y, rows = st["x"], st["y"], list(st["rows"])
        if rows == ["S..........S", "S..........S"]:
            x, rows = 1, ["S............S"] * 2  # 정면 두 손: 바디 B 어깨가 1px씩 넓음
        elif rows == ["p......p", "p......p"]:
            x, rows = 3, ["p........p"] * 2
        elif key.startswith('["carry_box_down') or "pose_hold_box_down" in key:
            x, rows = 2, [r[0] + r[1] + r[1:-1] + r[-2] + r[-1] if len(r) == 10 else r for r in rows]
        elif key.startswith('["carry_paper_down') or "pose_hold_paper_down" in key:
            x, rows = 2, [r[0] + r[1] + r[1:-1] + r[-2] + r[-1] for r in rows]
        elif key.startswith('["carry_box_up') or key.startswith('["carry_paper_up'):
            x, rows = 0, [r[:2] + ".." + r[2:-2] + r[-2:] for r in rows]
        elif key.startswith('["carry_cup_up'):
            x, rows = 12, ["OOOO", "OLLO", "OWWO", "OTTO", "OOOO"]
        elif key.startswith('["carry_cup_down') and rows == ["p", "p"]:
            x = 12
        elif rows == ["p", "p"] and "pose_hold_cup_down_1" in key:
            x = 12
        elif key.startswith('["carry_cup_down') or "pose_hold_cup_down" in key:
            x = 7
        st.update(x=x, rows=rows)
        out.append(st)
    return {"name": "kit-carry-b", "kit": True,
            "note": "T-149 바디 B용 들고 걷기 키트. kit-carry(바디 A)와 프레임·애니메이션 이름이 같음(carry_<box|paper|cup>_<dir>[_0|_1], pose_hold_<item>_<dir>_<0|1>). 바디 B 는 어깨가 1px씩 넓어 정면 손·상자·출력물을 2px 넓히고 뒷모습 소품을 바깥으로 1px 옮김. 지금 데이터에서 쓰는 캐릭터는 없음(바디 B 역할이 물건을 들게 되면 \"kits\": [\"kit-carry-b\"] 한 줄)",
            "frames": k["frames"], "anims": k.get("anims", []), "stamps": out}


# ---------------------------------------------------------------- 시설 타일

PICTO = {  # 8x8 공공시설 표준형 픽토그램(D 짙은 남회색). 캐릭터 그림에는 쓰지 않음
    "m": ["...DD...", "...DD...", "........", "..DDDD..", ".DDDDDD.", "..DDDD..", "..D..D..", "..D..D.."],
    "f": ["...DD...", "...DD...", "........", "...DD...", "..DDDD..", ".DDDDDD.", "..D..D..", "..D..D.."],
}


def door_tile(g, side):
    """세로 벽 문틀(양옆 O·L) + 문판(Q) + 12x12 표지판(외곽선 O, 테 1px = mine 하늘색 / other 회색, 흰 바탕 8x8 픽토그램)."""
    ring = "C" if side == "mine" else "M"
    rows = ["OLqQQQQQQQQQQqLO"] * 2
    rows.append("OL" + "O" * 12 + "LO")
    rows.append("OLO" + ring * 10 + "OLO"[2:] + "LO")
    for r in PICTO[g]:
        rows.append("OLO" + ring + r.replace(".", "W") + ring + "OLO"[2:] + "LO")
    rows.append("OLO" + ring * 10 + "OLO"[2:] + "LO")
    rows.append("OL" + "O" * 12 + "LO")
    rows += ["OLqQQQQQQQQQQqLO", "OLqqqqqqqqqqqqLO"]
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), (g, side, rows)
    return rows


def tiles():
    frames = []
    for g in ("m", "f"):
        for side in ("mine", "other"):
            frames.append({"name": "wall_door_restroom_%s_%s" % (g, side), "rows": door_tile(g, side)})
    frames.append({"name": "floor_locker", "rows": [
        "WWWqWWWqWWWqWWWq", "WLLqWLLqWLLqWLLq", "WLLqWLLqWLLqWLLq", "qqqqqqqqqqqqqqqq",
        "WWWqWWWqWWWqWWWq", "WLLqWLLqWLLqWLLq", "WLLqWLLqWLLqWLLq", "qqqqqqqqqqqqqqqq",
        "WWWqWWWqWWWqWWWq", "WLLqWLLqWLLqWLLq", "WLLqWLLqWLLqWLLq", "qqqqqqqqqqqqqqqq",
        "WWWqWWWqWWWqWWWq", "WLLqWLLqWLLqWLLq", "WLLqWLLqWLLqWLLq", "qqqqqqqqqqqqqqqq"]})
    frames.append({"name": "wall_locker", "rows": [
        "WWWWWWWWWWWWWWWW",
        "OOOOOOOOOOOOOOOO",
        "OLDDDDLOOLDDDDLO",
        "OLLLLLLOOLLLLLLO",
        "OLDDDDLOOLDDDDLO",
        "OLLLLLLOOLLLLLLO",
        "OLLLLLDOOLLLLLDO",
        "OLLLLLDOOLLLLLDO",
        "OLLLLLLOOLLLLLLO",
        "OLLLLLLOOLLLLLLO",
        "OMMMMMMOOMMMMMMO",
        "OOOOOOOOOOOOOOOO",
        "qqqqqqqqqqqqqqqq",
        "OOOOOOOOOOOOOOOO",
        "MMMMMMMMMMMMMMMM",
        "OOOOOOOOOOOOOOOO"]})
    return {"name": "t149-tile", "lean": True, "prefix": "tile2", "group": "tile", "size": [16, 16],
            "note": "T-149 성별 시설 타일. wall_door_restroom_<m|f>_<mine|other> = 가림막 문(세로 벽 문틀 + 문판) + 8x8 공공시설 표준 픽토그램 표지판. mine = 하늘색(cool, 플레이어 줄 색) 테두리, other = 회색(mid) 테두리. 빨강·주황 없음. 두 쪽 시설 안은 같은 그림(표지만 다름). floor_locker = 탈의실 바닥(흰·연회색 타일), wall_locker = 사물함 벽 앞면(남녀 공용 같은 그림)",
            "frames": frames}


def shower():
    base = [
        "................",
        "................",
        "OOOOOOOOOOOOOOOO",
        "OLLLLLLLLLLLLLLO",
        "OOOOOOOOOOOOOOOO",
        "OWWWWWWWWWWWWWLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLOOOLO",
        "OWLLLLLLLLLO#OLO",
        "OWLLLLLLLLLOOOLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLMMLLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLLLLLO",
        "OWLLLLLLLLLLLLLO",
        "OMMMMMMMMMMMMMMO",
        "OOOOOOOOOOOOOOOO",
        "OM............MO",
        "OM............MO",
        "OOO..........OOO",
        "................",
        "................",
    ]
    return {"name": "t149-shower", "lean": True, "prefix": "tile2", "group": "furniture", "size": [16, 24], "origin": [0.5, 1],
            "note": "T-149 헬스장 탈의실 샤워 칸(layout W). 화장실 칸 tall/stall 과 같은 크기·배치(원점 (0.5,1), 칸 아래 변 + 1px). 닫힌 문(연회색 판 + 흰 반사 + 손잡이) + 문 위 '사용 중' 표시창만 그림. 김(증기)·내부·인물 묘사 없음(컴플라이언스). shower_stall = 표시창 회색(비어 있음), shower_stall_hiding = 표시창 하늘색(플레이어가 안에 있음, 플레이어 줄 색). 남녀 탈의실 같은 그림",
            "frames": [{"name": "shower_stall", "rows": [r.replace("#", "M") for r in base]},
                       {"name": "shower_stall_hiding", "rows": [r.replace("#", "C") for r in base]}]}


# ---------------------------------------------------------------- 같은/다른 성별 표식

FIG = [".a.", "...", "aaa", "aaa", "a.a", "a.a"]


def mark12(fill, a, b):
    rows = [".OOOOOOOOOO.", "O" + fill * 10 + "O"]
    for r in FIG:
        rows.append("O" + fill + r.replace(".", fill).replace("a", a) + fill * 2 + r.replace(".", fill).replace("a", b) + fill + "O")
    rows += ["O" + fill * 10 + "O", ".OOOOOOOOOO.", ".....OO.....", ".....O......"]
    assert len(rows) == 12 and all(len(r) == 12 for r in rows)
    return rows


def marks():
    m12 = {"name": "t149-mark12", "lean": True, "prefix": "mark", "group": "ui", "size": [12, 12], "origin": [0.5, 1],
           "note": "T-149 '같은 성별 / 다른 성별' 표식(D-093, 인물 머리 위, 원점 아래 가운데). 플레이어 기준 관계만 보여 줌(절대 성별 그림 없음). gender_same = 하늘색 말풍선 + 똑같은 흰 사람 둘, gender_other = 회색 말풍선 + 흰 사람·짙은 사람(모양·명도로도 구분, 색약 대응). 빨강 없음",
           "frames": [{"name": "gender_same", "rows": mark12("C", "W", "W")},
                      {"name": "gender_other", "rows": mark12("M", "W", "D")}]}
    m8 = {"name": "t149-mark8", "lean": True, "prefix": "mark", "group": "ui", "size": [8, 8], "origin": [0.5, 1],
          "note": "T-149 표식 작은 판 8x8: gender_same_s = 하늘색 원 + '=', gender_other_s = 회색 원 + '≠'(사선)",
          "frames": [{"name": "gender_same_s", "rows": [".OOOOOO.", "OCCCCCCO", "OCWWWWCO", "OCCCCCCO", "OCWWWWCO", "OCCCCCCO", ".OOOOOO.", "...OO..."]},
                     {"name": "gender_other_s", "rows": [".OOOOOO.", "OMMMMWMO", "OMWWWWMO", "OMMMWMMO", "OMWWWWMO", "OMWMMMMO", ".OOOOOO.", "...OO..."]}]}
    return [m12, m8]


def charsel():
    W, H = 40, 52

    def card(edge, k):
        rows = []
        for y in range(H):
            r = []
            for x in range(W):
                d = min(x, y, W - 1 - x, H - 1 - y)
                corner = (x in (0, W - 1) and y in (0, H - 1))
                if corner:
                    r.append(".")
                elif d == 0:
                    r.append("O")
                elif d <= k:
                    r.append(edge)
                else:
                    r.append("W" if y < H - 12 else "F")
            rows.append("".join(r))
        return rows
    return {"name": "t149-charsel", "lean": True, "prefix": "ui", "group": "ui", "size": [W, H],
            "note": "T-149 캐릭터 선택 카드(남녀 공용 같은 판). charsel_card = 기본(연회색 테 1px), charsel_card_on = 선택(하늘색 테 3px). 초상 ui/charsel_portrait_<m|f>(32x40, 원점 아래 가운데)를 카드 왼쪽 위 기준 (4, 2)에 얹고(원점 기준이면 카드 (20, 42)), 이름표 글자는 코드가 아래 바닥색 띠(11px)에 씀. 미리 선택 없음·한쪽 강조 없음(gender-design §5)",
            "frames": [{"name": "charsel_card", "rows": card("L", 1)},
                       {"name": "charsel_card_on", "rows": card("C", 3)}]}


def portraits():
    import pixelgen
    legend = json.load(open(os.path.join(ART, "src", "legend.json"), encoding="utf-8"))["keys"]
    frames, _, errs = pixelgen.load_sprites(os.path.join(ART, "src"), legend)
    if errs:
        sys.exit("\n".join(errs))
    by = {f["key"]: f for f in frames}
    out = []
    for g in ("m", "f"):
        f = by["player_%s/idle_down" % g]
        sw = f["swap"]
        lan = sw.get("$lanyard")
        rows2 = []
        for r in f["rows"]:
            r = r.replace("N", "C" if lan == "cool" else "N")  # 줄 슬롯을 실제 색 문자로(초상은 단독 그림)
            rr = "".join(ch * 2 for ch in r)
            rows2 += [rr, rr]
        out.append({"name": "charsel_portrait_" + g, "rows": rows2})
    return {"name": "t149-portrait", "lean": True, "prefix": "ui", "group": "ui", "size": [32, 40], "origin": [0.5, 1],
            "note": "T-149 캐릭터 선택 초상: player_m / player_f 의 idle_down(같은 정면 대기 포즈)을 2배로 옮긴 32x40. 같은 크기·같은 포즈·같은 강조. 플레이어 머리를 고치면 t149_src.py --force 로 다시 만듦",
            "frames": out}


def variants():
    out = []
    for role, src, fn, mk, fk in ROLES:
        for g, hk in (("m", mk), ("f", fk)):
            d = {"name": "%s_%s" % (role, g), "variantOf": src, "lean": True}
            if role == "bg_buddy" and hk:
                d["kitsReplace"] = {"kit-head-buddy": "kit-head-" + hk.replace("_", "-")}
            elif hk:
                d["headKit"] = "kit-head-" + hk.replace("_", "-")
            d["note"] = "T-149 %s %s 변형(머리 길이 %s). %s. 소품·옷·사원증 줄 색·체형·특수 프레임은 원본 '%s'와 같음(D-093)" % (
                role, "남" if g == "m" else "여", LENGTH["%s_%s" % (role, g)],
                ("머리 키트 " + hk) if hk else "원본 머리 그대로", src)
            out.append((fn + "-" + g + ".json", d))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    files = []
    for vid, h in sorted(HEADS.items()):
        k = head_kit(vid, h)
        files.append((k["name"] + ".json", k))
    files.append(("kit-carry-b.json", kit_carry_b()))
    files += variants()
    files.append(("t149-tile.json", tiles()))
    files.append(("t149-shower.json", shower()))
    for m in marks():
        files.append((m["name"] + ".json", m))
    files.append(("t149-charsel.json", charsel()))

    def write(fn, d):
        p = os.path.join(SPR, fn)
        if os.path.exists(p) and not a.force:
            print("skip", fn)
            return
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("write", fn)
    for fn, d in files:
        write(fn, d)
    write("t149-portrait.json", portraits())  # 변형이 원본에 들어간 뒤 해석


if __name__ == "__main__":
    main()
