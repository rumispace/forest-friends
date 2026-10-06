#!/bin/bash
# Mac 에서 게임 서버를 띄우고, 같은 Wi-Fi 의 iPad 에서 열 주소를 알려준다
cd "$(dirname "$0")"
PORT=8125
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
echo ""
echo "  iPad Safari 에서 열기:  http://$IP:$PORT"
echo "  (끄려면 Ctrl+C)"
echo ""
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  서버가 이미 켜져 있어요. 위 주소로 바로 열면 됩니다."
  exit 0
fi
python3 -m http.server $PORT --bind 0.0.0.0
