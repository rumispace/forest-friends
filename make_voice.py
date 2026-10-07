#!/usr/bin/env python3
"""story.json 의 모든 대사를 성우 음성 파일로 미리 만든다.

    python3 make_voice.py            # 새로 생긴 대사만 만든다
    python3 make_voice.py --all      # 전부 다시 만든다

결과: voice/<번호>.mp3 + voice/index.json (대사 → 파일)
대사를 고쳤으면 이 스크립트를 다시 돌리면 된다.
아빠 목소리로 바꾸고 싶으면 같은 파일 이름으로 녹음해 덮어쓰면 된다.
"""
import asyncio, hashlib, json, sys
from pathlib import Path

import edge_tts

# 캐릭터마다 다른 목소리 (이름, 속도, 높이). 높이를 억지로 바꾸면 기계음처럼 들려서 원래 톤 그대로 쓴다.
# 다국어 목소리도 한국어를 정확히 말한다 (Whisper 받아쓰기로 97~100% 확인, 2026-10-07)
SUNHI, INJOON, HYUNSU = "ko-KR-SunHiNeural", "ko-KR-InJoonNeural", "ko-KR-HyunsuMultilingualNeural"
EMMA, AVA, ANDREW, BRIAN = "en-US-EmmaMultilingualNeural", "en-US-AvaMultilingualNeural", "en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural"
WILLIAM, SERAPHINA, FLORIAN = "en-AU-WilliamMultilingualNeural", "de-DE-SeraphinaMultilingualNeural", "de-DE-FlorianMultilingualNeural"
VIVIENNE, REMY, GIUSEPPE, THALITA = "fr-FR-VivienneMultilingualNeural", "fr-FR-RemyMultilingualNeural", "it-IT-GiuseppeMultilingualNeural", "pt-BR-ThalitaMultilingualNeural"
VOICES = {
    "narr":       (SUNHI, "+10%", "+0Hz"),      # 해설
    "goldie":     (EMMA, "+12%", "+0Hz"),       # 골디: 밝고 다정하게
    "smogi":      (INJOON, "+12%", "+0Hz"),     # 잿빛 마법사 스모기
    "jjiri":      (HYUNSU, "+16%", "+0Hz"),     # 번개 꼬마 찌릿이: 빠르게
    "boss":       (GIUSEPPE, "-2%", "-4Hz"),    # 먹구름 대마왕: 낮고 묵직하게
    "squirrel":   (SERAPHINA, "+14%", "+0Hz"),
    "cicada":     (REMY, "+12%", "+0Hz"),
    "ladybug":    (THALITA, "+12%", "+0Hz"),
    "rhino":      (ANDREW, "+8%", "+0Hz"),      # 장수풍뎅이: 힘센 형
    "stag":       (FLORIAN, "+8%", "+0Hz"),
    "minnow":     (VIVIENNE, "+12%", "+0Hz"),
    "crayfish":   (BRIAN, "+10%", "+0Hz"),
    "kingfisher": (EMMA, "+14%", "+0Hz"),
    "crab":       (REMY, "+14%", "+0Hz"),
    "hermit":     (THALITA, "+10%", "+0Hz"),
    "starfish":   (SERAPHINA, "+8%", "+0Hz"),
    "bat":        (FLORIAN, "+10%", "+0Hz"),
    "salamander": (VIVIENNE, "+10%", "+0Hz"),
    "badger":     (WILLIAM, "+6%", "+0Hz"),     # 오소리 아저씨
    "mudskipper": (REMY, "+14%", "+0Hz"),
    "fiddler":    (ANDREW, "+12%", "+0Hz"),
    "spoonbill":  (SERAPHINA, "+10%", "+0Hz"),
    "hare":       (THALITA, "+14%", "+0Hz"),
    "goral":      (BRIAN, "+8%", "+0Hz"),
    "owl":        (WILLIAM, "+0%", "+0Hz"),     # 부엉이 할아버지: 천천히
}

def tts_text(s):
    """읽기용으로만 다듬기: 말줄임표는 짧은 쉼표로 (길게 끊겨 어색했다)"""
    return s.replace("…", ",").replace("...", ",").replace(" ,", ",")

ROOT = Path(__file__).parent
OUT = ROOT / "voice"


def lines(story):
    """(대사, 목소리) 목록. 같은 대사는 한 번만."""
    out, seen = [], set()
    def add(s, who="narr"):
        s = " ".join(s.split())
        if s and s not in seen:
            seen.add(s); out.append((s, who))
    for f in story["friends"]:
        add(f["intro"]); add(f.get("arrive", ""))
        for x in f["facts"]: add(x)
    for r in story["regions"].values(): add(r["enter"])
    for c in story.get("chapters", []): add(c["doneText"])
    for m in story["missions"]:
        add(m["text"]); add(m["text"] + "!"); add(m.get("announce", ""))
        for key in ("lines", "before", "after"):
            for ln in m.get(key, []):
                who = ln["who"]
                add(ln["text"], who if who in VOICES else "narr")
    for f in story.get("visitors", []):
        add(f["intro"]); add(f["arrive"])
        for x in f["facts"]: add(x)
    for q in story.get("quests", []): add(q["text"])
    for h in story.get("heroes", {}).values(): add(h["line"])
    for it in story.get("items", []): add(it["got"]); add(it["desc"])
    for lst in story.get("fish", {}).values():
        for f in (lst if isinstance(lst, list) else [lst]):
            add(f["got"]); add(f["fact"])
    for v in story["msg"].values():
        for x in (v if isinstance(v, list) else [v]): add(x)
    return out


async def main():
    story = json.loads((ROOT / "story.json").read_text())
    OUT.mkdir(exist_ok=True)
    redo = "--all" in sys.argv
    index = {}
    todo = []
    for s, who in lines(story):
        name = hashlib.sha1(("|".join(VOICES.get(who, VOICES["narr"])) + "|" + s).encode()).hexdigest()[:10] + ".mp3"
        index[s] = name
        if redo or not (OUT / name).exists():
            todo.append((s, who, name))
    for i, (s, who, name) in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] ({who}) {s}")
        voice, rate, pitch = VOICES.get(who, VOICES["narr"])
        await edge_tts.Communicate(tts_text(s), voice, rate=rate, pitch=pitch).save(str(OUT / name))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=0))
    keep = set(index.values()) | {"index.json"}
    for f in OUT.iterdir():
        if f.name not in keep:
            f.unlink()
    print(f"대사 {len(index)}개, 새로 만든 것 {len(todo)}개")


asyncio.run(main())
