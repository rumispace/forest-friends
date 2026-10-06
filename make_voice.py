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

VOICE = "ko-KR-SunHiNeural"   # 밝은 여자 성우 음색
RATE, PITCH = "-6%", "+8Hz"   # 아이용: 조금 느리고 밝게

ROOT = Path(__file__).parent
OUT = ROOT / "voice"


def lines(story):
    out = []
    def add(s):
        s = " ".join(s.split())
        if s and s not in out:
            out.append(s)
    for f in story["friends"]:
        add(f["intro"]); add(f.get("arrive", ""))
        for x in f["facts"]: add(x)
    for r in story["regions"].values(): add(r["enter"])
    for m in story["missions"]:
        add(m["text"]); add(m["text"] + "!"); add(m.get("announce", ""))
    for v in story["msg"].values():
        for x in (v if isinstance(v, list) else [v]): add(x)
    return out


async def main():
    story = json.loads((ROOT / "story.json").read_text())
    OUT.mkdir(exist_ok=True)
    redo = "--all" in sys.argv
    index = {}
    todo = []
    for s in lines(story):
        name = hashlib.sha1(s.encode()).hexdigest()[:10] + ".mp3"
        index[s] = name
        if redo or not (OUT / name).exists():
            todo.append((s, name))
    for i, (s, name) in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {s}")
        await edge_tts.Communicate(s, VOICE, rate=RATE, pitch=PITCH).save(str(OUT / name))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=0))
    keep = set(index.values()) | {"index.json"}
    for f in OUT.iterdir():
        if f.name not in keep:
            f.unlink()
    print(f"대사 {len(index)}개, 새로 만든 것 {len(todo)}개")


asyncio.run(main())
