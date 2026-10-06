# 숲속 친구들 탐험대

7~8세용 3D 자연 탐험 미션 게임 (Three.js, 설치 없음)

## 실행
    bash start.sh
화면에 나온 주소를 같은 Wi-Fi 의 iPad Safari 에서 연다.

## 지도
숲(가운데) → 계곡(위, 숲 미션을 마치면 열림) → 바닷가(오른쪽, 계곡 미션을 마치면 열림)
미션 12개: 숲 6 · 계곡 3 · 바닷가 3

## 대사·도감 고치기
1. `story.json` 의 문구를 고친다
2. `python3 make_voice.py` → 바뀐 대사만 성우 음성(voice/)을 새로 만든다
3. index.html 의 `?v=` 숫자를 올리면 iPad 가 새 버전을 받는다
아빠 목소리로 바꾸려면 voice/index.json 에서 대사의 파일 이름을 찾아 같은 이름 mp3 로 덮어쓰면 된다.

## 파일
- index.html / style.css / game.js / story.json
- voice/ (성우 음성, make_voice.py 로 생성)
- lib/three.module.min.js (three r170, 오프라인 동작용)
