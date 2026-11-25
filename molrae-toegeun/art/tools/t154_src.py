#!/usr/bin/env python3
"""T-154 원본 갱신: 남녀 구분을 머리 모양으로 더 뚜렷하게(D-101). D-093 금지 사항(치마·화장·체형·피부·옷 차이)은 그대로.

  python3 art/tools/t154_src.py

T-149 머리 키트를 다시 씀(덮어씀. 원본은 JSON 이고 이 스크립트가 그 JSON 의 출처).
  - 여성 변형 다수: 어깨까지 내려오는 머리(L, 머리 아래 11~12행까지 옆머리가 내려옴) 또는 묶음(T, 옆·뒷모습 실루엣이 1~2px 튀어나옴)
  - 남성 변형 다수: 원본 짧은 머리(S). 대표님·배경 B 남성은 원본 짧은 머리로 바꿈(키트 없음 → 시트 영역 공유)
  - 예외 유지: 옆 팀 동기(성별 회전 인물)는 남 웨이브 단발 · 여 짧은 뽀글 그대로. 정의로운 동료·인사팀 남성은 원본 단발(M) 그대로
  - 역할 표지(소품·줄 색·옷·바디)는 바꾸지 않음. 사원증 줄은 뒷모습에서도 보이게 긴 머리 가운데를 비움
쓰는 파일(art/src/sprites/)
  kit-head-<variant>.json      여성 머리 키트 11종(+ 옆 팀 동기 남 키트는 손대지 않음)
  char-<role>-m.json / -f.json 변형 26종(키 이름 그대로)
  t149-portrait.json           ui/charsel_portrait_m/_f (player 남녀 idle_down 2배)
지우는 파일: kit-head-ceo-m.json, kit-head-bg-b-m.json (남성 원본 머리로 바뀌어 안 씀)
표준 라이브러리만 사용. 결정적(같은 입력 → 같은 파일).
"""
import json
import os
import sys

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ART, "src", "sprites")
sys.path.insert(0, os.path.join(ART, "tools"))
import pixelgen  # noqa: E402

# ---------------------------------------------------------------- 머리 아래(11~12행) 덧그림
# 바디 A: 정면·뒷모습 11행 몸 4~11열, 12행 3~12열 / 옆모습 11행 5~11열, 12행 4~11열
# 바디 B: 정면·뒷모습 11행 3~12열, 12행 2~13열 / 옆모습 11행 4~11열, 12행 3~11열
# '.' 은 건너뜀(몸·소품 그대로). 뒷모습은 가운데(목 뒤 사원증 줄)를 비워 줄 색이 네 방향 모두 보이게 함.
EXT_A = {
    "down": [".OHH........HHO.", "..OO........OO.."],
    "up": [".OHH........HHO.", "..OO........OO.."],
    "right": [".OHHH...........", "..OOO..........."],
}
EXT_A_FLIP = {  # 끝이 바깥으로 뻗친 단발(플레이어): 끝이 또렷하게 보임
    "down": ["OHHH........HHHO", ".OOO........OOO."],
    "up": ["OHHH........HHHO", ".OOO........OOO."],
    "right": ["OHHHH...........", ".OOOO..........."],
}
EXT_B = {
    "down": ["OHH..........HHO", "OO............OO"],
    "up": ["OHH..........HHO", "OO............OO"],
    "right": ["OHHH............", "OOO............."],
}

HEADS = {}

# 플레이어 여(L): 어깨 단발, 끝이 바깥으로 뻗침 + 플레이어 표지 정수리 갈고리 삐침·왼쪽 옆머리 삐침 유지
HEADS["player_f"] = dict(body="A", length="L", note="플레이어 여: 어깨에 닿는 단발(끝이 바깥으로 뻗침) + 정수리 갈고리 삐침·옆머리 삐침(플레이어 표지) 유지", down=[
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
    ".OHHOOssssOOHHO.",
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
    ".OHHHHHHHHHHHHO.",
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
    ".OHHHHOsssOOO...",
], ext=EXT_A_FLIP, extra=[
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
    {"frames": ["disguise"], "x": 0, "y": 8, "_note": "위장: 서류 양옆으로 뻗친 머리끝", "rows": [
        "O..............O",
        "O..............O",
    ]},
    {"frames": ["caught"], "clear": True, "x": 0, "y": 0, "_note": "들킴: 머리카락 곤두섬 + 흰자 눈 + 벌린 입(손은 원본 그대로). 옆머리는 10행까지", "rows": [
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
        "OOHHOOssssOOHHOO",
    ]},
    {"frames": ["caught"], "x": 0, "y": 11, "rows": [
        "...H........H...",
        "...O........O...",
    ]},
])

# 선배 여(L): 구름 머리가 어깨까지 부풂
HEADS["senior_f"] = dict(body="A", length="L", note="선배 여: 어깨까지 부푼 구름 머리(웃는 눈·볼터치는 역할 표지라 남녀 같음)", down=[
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
    "OHHOOOssssOOOHHO",
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
    "OHHHHHHHHHHHHHHO",
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
    "OHHHHHOsssOOO...",
], ext={
    "down": ["OHHH........HHHO", ".OHO........OHO.", "..O..........O.."],
    "up": ["OHHH........HHHO", ".OHO........OHO.", "..O..........O.."],
    "right": ["OHHHH...........", ".OHOO...........", "..O............."],
})

# 팀장 여(L): 볼륨 옆 가르마, 어깨까지
HEADS["teamlead_f"] = dict(body="B", length="L", note="팀장 여: 볼륨 옆 가르마 + 어깨까지 내려오는 머리(굵은 눈썹·결재판은 역할 표지)", down=[
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
    ".OHHOOssssOOHHO.",
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
    ".OHHHHHHHHHHHHO.",
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
    ".OHHHHOsssOOO...",
], ext=EXT_B)

# 본부장 여(T): 올백 + 뒤통수 위로 올린 큰 똥머리(옆·뒤에서 위·뒤로 튀어나옴)
HEADS["exec_f"] = dict(body="B", length="T", note="본부장 여: 올백 + 뒤통수 위로 올려 묶은 큰 쪽머리(옆모습 뒤·위로 2px, 뒷모습 위로 1px 튀어나옴), 관자놀이 옆머리", down=[
    ".....OOOOOO.....",
    "..OOOHHDHHHOOO..",
    "..OHHHLLLLHHHO..",
    ".OHHHHHHMMHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSOOSSSSOOSHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSSSSssSSSSHO.",
    "..OOOOssssOOOO..",
], up=[
    ".....OOOOOO.....",
    "..OOOHHHDHHOOO..",
    "..OHOHHHHHHOHO..",
    ".OHHHOOOOOOHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHMMHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OSHHHHHHHHHHSO.",
    ".OHHHHHHHHHHHHO.",
    "..OOOOssssOOOO..",
], right=[
    ".OOOO...........",
    "OHHDHOOOOOOO....",
    "OHHHHOHLLLHO....",
    "OHHHHOHHMHHHO...",
    ".OOOOHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHHHHSSSSSO..",
    ".OHHHHHSSSOOSO..",
    ".OHHHHHsSSSSSO..",
    ".OHHHHHSSSSSSO..",
    "..OOOOOsssOOO...",
])

# 대표님 여(L): 원본 퐁파두르 + 코트 어깨에 닿는 긴 머리
HEADS["ceo_f"] = dict(body="B", length="L", note="대표님 여: 원본 퐁파두르 + 롱코트 어깨에 닿는 긴 머리(금 넥타이·롱코트는 역할 표지)", down=[
    "....OOOOOOO.....",
    "..OOHHHHHHHOO...",
    "..OHHHLLHHHHHO..",
    ".OHHHLHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSSSssSSSSHO.",
    ".OHHOOssssOOHHO.",
], up=[
    ".....OOOOOOO....",
    "...OOHHHHHHHOO..",
    "..OHHHHHLLHHHO..",
    ".OHHHHHHHHLHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
], right=[
    ".....OOOOOO.....",
    "...OOHHHHHHOO...",
    "..OHHHHHHLLHHO..",
    ".OHHHHHHHHHLHHO.",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHHHSSSSOSO..",
    ".OHHHHHsSSSOSO..",
    ".OHHHHHSSSSOSO..",
    ".OHHHHOsssOOO...",
], ext={
    "down": [".OHH........HHO.", "..OO........OO.."],
    "up": [".OHHH......HHHO.", "..OOO......OOO.."],
    "right": ["OHH.............", "OO.............."],
})

# 경비 여(T): 모자 + 뒤로 길게 내린 포니테일(옆모습 뒤로 1px·아래로 2px, 뒷모습 아래로 2px)
HEADS["guard_f"] = dict(body="B", length="T", note="경비 여: 챙 모자 + 목 아래까지 내려오는 포니테일, 정면 귀 옆 옆머리(챙 모자·손전등은 역할 표지)", down=[
    "...OOOOOOOOOO...",
    "..ODDDDYYDDDDO..",
    ".ODDDDDDDDDDDDO.",
    ".ODDDDDDDDDDDDO.",
    "OOOOOOOOOOOOOOOO",
    ".OHHSSSSSSSSHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSSSssSSSSHO.",
    "..OOOOssssOOOO..",
], up=[
    "...OOOOOOOOOO...",
    "..ODDDDDDDDDDO..",
    ".ODDDDDDDDDDDDO.",
    ".ODDDDDDDDDDDDO.",
    ".OOOOOOOOOOOOOO.",
    ".OHHHHHMMHHHHHO.",
    ".OHHHHODDOHHHHO.",
    ".OHHHHODDOHHHHO.",
    ".OSHHHODDOHHHSO.",
    ".OHHHHODDOHHHHO.",
    "..OOOOODDOOOOO..",
], right=[
    "..OOOOOOOOO.....",
    "..ODDDDDDYDO....",
    ".ODDDDDDDDDDO...",
    ".ODDDDDDDDDDDO..",
    ".OOOOOOOOOOOOOOO",
    "OMOHHHHHHHHHHO..",
    "ODOHHHHHHSSSSO..",
    "ODOHHHHSSSSOSO..",
    "ODOHHHHsSSSOSO..",
    "ODOHHHHSSSSSSO..",
    "ODOOOOOsssOOO...",
], ext={
    "up": [".......DD.......", ".......OO......."],
    "right": ["ODO.............", ".O.............."],
})

# 정의로운 동료 여(L): 일자 앞머리 + 어깨까지 곧게 내린 머리
HEADS["snitch_f"] = dict(body="B", length="L", note="정의로운 동료 여: 일자 앞머리 + 어깨까지 곧은 긴 머리(사각 안경·메모장은 역할 표지)", down=[
    "................",
    "..OOOOOOOOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHDDHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHOCCOOOOCCOHO.",
    ".OHOWCOSSOWCOHO.",
    ".OHSSSSssSSSSHO.",
    ".OHHOOssssOOHHO.",
], up=[
    "................",
    "..OOOOOOOOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHDDHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
], right=[
    "................",
    "..OOOOOOOOOO....",
    "..OHHHHHHHHO....",
    ".OHHHHHHDDHHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHHHOOOCCOO..",
    ".OHHHHHsSOWCOO..",
    ".OHHHHHSSSSSSO..",
    ".OHHHHOsssOOO...",
], ext=EXT_B)

# 공범 여(T): 헤드폰 위로 높이 묶은 큰 포니테일(옆모습 뒤로 튀어나와 9행까지, 뒷모습 목 아래 12행까지)
HEADS["accomplice_f"] = dict(body="A", length="T", note="공범 여: 헤드폰 + 정수리 뒤로 높이 묶은 큰 포니테일(옆모습 뒤로 튀어나옴, 뒷모습 목 아래까지)", down=[
    "..............O.",
    ".....OOOOOO..OHO",
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
    "OGGOHHODDOHHOGGO",
    "OGgOHHODDOHHOgGO",
    "OGgOHHODDOHHOgGO",
    ".OOSHHODDOHHSOO.",
    "..OHHHODDOHHHO..",
    "...OOOODDOOOO...",
], right=[
    "................",
    "OOOO.OOOOOO.....",
    "ODDMOHHGGHHOO...",
    "ODDOHHHGGHDDHO..",
    "ODDOHHHGGHHHDHO.",
    "ODDOHOOOOOHHHHO.",
    "ODOHOGGgOHSSSO..",
    "ODOHOGGgOSSOSO..",
    "OO.HHOOOsSSOSO..",
    "..OHHHHSSSSSSO..",
    "...OOOOsssOOO...",
], ext={
    "up": [".......DD.......", ".......OO......."],
})

# 인사팀 여(L): 가운데 가르마 + 어깨까지 긴 머리
HEADS["hr_f"] = dict(body="A", length="L", note="인사팀 여: 가운데 가르마 + 어깨까지 내려오는 긴 머리(명부·보라 띠 카드는 역할 표지)", down=[
    "................",
    ".....OOOOOO.....",
    "...OOHHMHHHOO...",
    "..OHHHHMHHHHHO..",
    ".OHHHHMMHHHHHHO.",
    ".OHHHSSSSSHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSOSSSSOSHHO.",
    ".OHHSSSssSSSHHO.",
    ".OHHOOssssOOHHO.",
], up=[
    "................",
    ".....OOOOOO.....",
    "...OOHHHMHHOO...",
    "..OHHHHHMHHHHO..",
    ".OHHHHHHMHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
], right=[
    "................",
    "....OOOOOO......",
    "...OHHHHHHOO....",
    "..OHHHHHHMHHO...",
    ".OHHHHHHHHMHHO..",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHSSSSO..",
    ".OHHHHHSSSSOSO..",
    ".OHHHHHsSSSOSO..",
    ".OHHHHHSSSSSSO..",
    ".OHHHHOsssOOO...",
], ext=EXT_A)

# 배경 A 여(L): 옆 가르마 + 어깨까지
HEADS["bg_a_f"] = dict(body="A", length="L", note="배경 A 여: 옆 가르마 + 어깨까지 내려오는 머리", down=[
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
    ".OHHOOssssOOHHO.",
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
    ".OHHHHHHHHHHHHO.",
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
    ".OHHHHOsssOOO...",
], ext=EXT_A, sit_up=["sit_type_*", "sit_stretch_*"], ext_skip=["sit_stretch_0", "sit_stretch_1"])

# 배경 B 여(T): 원본 정수리 한 가닥 + 낮게 묶은 포니테일(옆모습 뒤로·아래로, 뒷모습 목 아래까지)
HEADS["bg_b_f"] = dict(body="B", length="T", note="배경 B 여: 정수리 한 가닥(원본) + 낮게 묶은 포니테일, 정면 귀 옆 옆머리", down=[
    ".......O........",
    "..OOOOOOHOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHDDHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OHSSSSssSSSSHO.",
    "..OOOOssssOOOO..",
], up=[
    ".......O........",
    "..OOOOOOHOOOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHDDHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHMMHHHHHO.",
    ".OSHHHODDOHHHSO.",
    ".OHHHHODDOHHHHO.",
    "..OOOOODDOOOOO..",
], right=[
    ".......O........",
    "..OOOOOOHOOO....",
    "..OHHHHHHHHO....",
    ".OHHHHHHDDHHO...",
    ".OHHHHHHHHHHHO..",
    ".OHHHHHHHHHHHO..",
    "OOMHHHHHHSSSSO..",
    "ODOHHHHSSSSOSO..",
    "ODOHHHHsSSSOSO..",
    "ODOHHHHSSSSSSO..",
    "ODOOOOOsssOOO...",
], ext={
    "up": [".......DD.......", ".......OO......."],
    "right": ["ODO.............", ".O.............."],
}, sit_up=["sit_type_*"])

# 배경 C 여(T): 정수리 큰 똥머리(위로 2px)
HEADS["bg_c_f"] = dict(body="A", length="T", note="배경 C 여: 정수리 위로 크게 올린 똥머리(모든 방향에서 위로 2px 튀어나옴)", down=[
    "....OOOOOO......",
    "...OHHDHHHO.....",
    "...OOHHMHOOOO...",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    ".OHSSOSSSSOSSHO.",
    ".OSSSOSSSSOSSSO.",
    "..OSSSSssSSSSO..",
    "...OOOssssOOO...",
], up=[
    "......OOOOOO....",
    ".....OHHHDHHO...",
    "...OOOOHMHHOOO..",
    "..OHHHHHHHHHHO..",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OSHHHHHHHHHHSO.",
    "..OHHHHHHHHHHO..",
    "...OOOssssOOO...",
], right=[
    ".OOOOO..........",
    "OHHDHHO.........",
    "OHHHHHOOOO......",
    ".OOMHHHHHHOO....",
    ".OHHHHHHHHHHO...",
    ".OHHHHHHHHSSSO..",
    ".OHHHHHHSSSSSO..",
    ".OHHHHHSSSSOSO..",
    ".OHHHHHsSSSOSO..",
    "..OHHHHSSSSSSO..",
    "...OOOOsssOOO...",
], sit_up=["sit_type_*"])

# ---------------------------------------------------------------- 변형 배정 (D-101)
# (role, 원본 sprite, 파일 접두, m 머리 키트, f 머리 키트). None = 원본 머리 그대로
ROLES = [
    ("player", "player", "char-player", None, "player_f"),
    ("senior", "senior", "char-senior", None, "senior_f"),
    ("teamlead", "teamlead", "char-teamlead", None, "teamlead_f"),
    ("exec", "exec", "char-exec", None, "exec_f"),
    ("ceo", "ceo", "char-ceo", None, "ceo_f"),
    ("guard", "guard", "char-guard", None, "guard_f"),
    ("snitch", "snitch", "char-snitch", None, "snitch_f"),
    ("accomplice", "accomplice", "char-accomplice", None, "accomplice_f"),
    ("hr", "hr", "char-hr", None, "hr_f"),
    ("bg_a", "bg_a", "char-bg-a", None, "bg_a_f"),
    ("bg_b", "bg_b", "char-bg-b", None, "bg_b_f"),
    ("bg_c", "bg_c", "char-bg-c", None, "bg_c_f"),
    ("bg_buddy", "bg_buddy", "char-buddy", "bg_buddy_m", None),  # 예외 유지(T-149 그대로)
]
LENGTH = {  # S 짧음, M 귀~턱 단발, L 어깨까지, T 묶음
    "player_m": "S", "player_f": "L", "senior_m": "S", "senior_f": "L", "teamlead_m": "S", "teamlead_f": "L",
    "exec_m": "S", "exec_f": "T", "ceo_m": "S", "ceo_f": "L", "guard_m": "S", "guard_f": "T",
    "snitch_m": "M", "snitch_f": "L", "accomplice_m": "S", "accomplice_f": "T", "hr_m": "M", "hr_f": "L",
    "bg_a_m": "S", "bg_a_f": "L", "bg_b_m": "S", "bg_b_f": "T", "bg_c_m": "S", "bg_c_f": "T",
    "bg_buddy_m": "M", "bg_buddy_f": "S",
}
REMOVE = ["kit-head-ceo-m.json", "kit-head-bg-b-m.json"]


def src_frame_names():
    """원본 스프라이트(변형 아님)별 프레임 이름. 머리 아래 덧그림 대상 계산용(원본은 이 스크립트가 바꾸지 않음)."""
    legend = pixelgen.load_json(os.path.join(ART, "src", "legend.json"))["keys"]
    frames, _, errs = pixelgen.load_sprites(os.path.join(ART, "src"), legend)
    if errs:
        sys.exit("\n".join(errs))
    out = {}
    for f in frames:
        out.setdefault(f["sprite"], []).append(f["frame"])
    return out


def head_kit(vid, h, names):
    st = []
    for d in ("down", "up", "right"):
        s = {"dir": d, "clear": True, "x": 0, "y": 0, "rows": h[d]}
        m = h.get("sit_up", []) if d == "up" else []
        if m:
            s["match"] = m
        st.append(s)
        ext = (h.get("ext") or {}).get(d)
        if ext:
            tg = pixelgen.stamp_targets(s, names)
            tg = [n for n in tg if n not in h.get("ext_skip", [])]
            st.append({"frames": tg, "x": 0, "y": 11, "_note": "머리 아래(11행~) 옆머리·묶음 끝. '.'은 몸·소품 그대로", "rows": ext})
    st += h.get("extra", [])
    for s in st:
        for r in s["rows"]:
            assert len(r) == 16, (vid, r)
    for d in ("down", "up", "right"):
        assert len(h[d]) == 11, (vid, d)
    return {"name": "kit-head-" + vid.replace("_", "-"), "kit": True,
            "note": "T-154 머리 키트(바디 %s, 머리 길이 %s): %s. D-101: 남녀가 머리 모양으로 한눈에 갈리게. D-093: 체형·피부·옷·소품·줄 색은 역할 원본과 같음" % (h["body"], h["length"], h["note"]),
            "stamps": st}


def variants():
    out = []
    for role, src, fn, mk, fk in ROLES:
        for g, hk in (("m", mk), ("f", fk)):
            d = {"name": "%s_%s" % (role, g), "variantOf": src, "lean": True}
            if role == "bg_buddy" and hk:
                d["kitsReplace"] = {"kit-head-buddy": "kit-head-" + hk.replace("_", "-")}
            elif hk:
                d["headKit"] = "kit-head-" + hk.replace("_", "-")
            d["note"] = "T-154 %s %s 변형(머리 길이 %s). %s. 소품·옷·사원증 줄 색·체형·특수 프레임은 원본 '%s'와 같음(D-093, D-101)" % (
                role, "남" if g == "m" else "여", LENGTH["%s_%s" % (role, g)],
                ("머리 키트 " + hk) if hk else "원본 머리 그대로", src)
            out.append((fn + "-" + g + ".json", d))
    return out


def write(fn, d):
    p = os.path.join(SPR, fn)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("write", fn)


def main():
    names = src_frame_names()
    role_src = {"%s_f" % r: s for r, s, _, _, _ in ROLES}
    for vid, h in sorted(HEADS.items()):
        k = head_kit(vid, h, names[role_src[vid]])
        write(k["name"] + ".json", k)
    for fn, d in variants():
        write(fn, d)
    for fn in REMOVE:
        p = os.path.join(SPR, fn)
        if os.path.exists(p):
            os.remove(p)
            print("remove", fn)
    import t149_src
    write("t149-portrait.json", t149_src.portraits())


if __name__ == "__main__":
    main()
