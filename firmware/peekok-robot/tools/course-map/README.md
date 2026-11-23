# 코스 지도 (로컬 예시)

로봇이 회전·유턴 기록으로 자기 위치를 알아내고, 웹 지도에 실시간으로 보여 준다. 추가 설치 없음(파이썬 기본 기능만).

```
python3 firmware/peekok-robot/tools/course-map/bridge.py            # 브라우저로 http://localhost:8790
python3 firmware/peekok-robot/tools/course-map/bridge.py --demo     # 로봇 없이 가짜 주행 기록으로 시험
python3 firmware/peekok-robot/tools/course-map/bridge.py --host 192.168.0.17
```

- 위치 맞추기: `[판단]`(왼쪽/오른쪽 분기·T자)이 나오면 지도에서 그 모양이 나오는 가장 가까운 점으로 위치를 맞춘다.
  `[자동] … 좌회전/우회전/유턴` 으로 들어간 길을 바꾸고, 점 사이는 달린 시간 × 속도(점을 지날 때마다 스스로 맞춤).
- 첫 분기에서 왼쪽/오른쪽이 사진과 반대면 지도를 위아래로 뒤집는다(화면 버튼으로도 가능).
- 분기를 놓치면 직진으로 지나간 것으로 보고, 다음 판단 때 맞는 점을 찾아 다시 맞춘다.
- 로봇 무선 시리얼(2323)은 한 번에 하나만 붙으므로, 지도를 켜 둔 동안에는 `run` 대신 화면의 시작·멈춤·명령 칸을 쓴다.
- 지도 모양은 `bridge.py` 의 `NODES`·`EDGES`·`CAPS` (사진 픽셀 좌표). 출발점은 오른쪽 열린 끝(S).
