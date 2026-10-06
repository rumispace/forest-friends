#!/bin/bash
# 게임을 인터넷(GitHub Pages)에 올린다.
# 버전 번호를 올려 두면 iPad 는 다음에 열 때 자동으로 새 버전을 받는다.
#   bash deploy.sh "바꾼 내용 한 줄"
cd "$(dirname "$0")"
date +'{"v":"%Y%m%d%H%M%S"}' > version.json
git add -A
git commit -q -m "${1:-게임 업데이트}" || true
git push -q origin main || { echo "  올리기 실패: gh auth status 를 확인하세요"; exit 1; }
echo ""
echo "  올렸어요: https://rumispace.github.io/forest-friends/"
echo "  (1~2분 뒤 반영돼요)"
