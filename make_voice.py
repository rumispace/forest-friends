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

# 역할별 목소리 (이름, 속도, 높이)
VOICES = {
    "narr":   ("ko-KR-SunHiNeural", "-6%", "+8Hz"),     # 해설: 밝은 여자 성우
    "friend": ("ko-KR-SunHiNeural", "+2%", "+22Hz"),    # 골디·숲속 친구들: 더 귀엽게
    "smogi":  ("ko-KR-InJoonNeural", "+8%", "+4Hz"),    # 악당 스모기: 장난스러운 남자 목소리
    "boss":   ("ko-KR-HyunsuMultilingualNeural", "-12%", "-14Hz"),  # 먹구름 대마왕: 낮고 느리게
    "jjiri":  ("ko-KR-HyunsuMultilingualNeural", "+14%", "+24Hz"),  # 번개 꼬마 찌릿이: 빠르고 높게
}

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
                add(ln["text"], who if who in ("narr", "smogi", "boss", "jjiri") else "friend")
    for f in story.get("visitors", []):
        add(f["intro"]); add(f["arrive"])
        for x in f["facts"]: add(x)
    for q in story.get("quests", []): add(q["text"])
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
        name = hashlib.sha1((who + "|" + s).encode()).hexdigest()[:10] + ".mp3"
        index[s] = name
        if redo or not (OUT / name).exists():
            todo.append((s, who, name))
    for i, (s, who, name) in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] ({who}) {s}")
        voice, rate, pitch = VOICES[who]
        await edge_tts.Communicate(s, voice, rate=rate, pitch=pitch).save(str(OUT / name))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=0))
    keep = set(index.values()) | {"index.json"}
    for f in OUT.iterdir():
        if f.name not in keep:
            f.unlink()
    print(f"대사 {len(index)}개, 새로 만든 것 {len(todo)}개")


asyncio.run(main())
