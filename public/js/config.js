/* 안내 로봇 기본 설정
 * 관리자 화면(상단 시계를 3초간 길게 누르기)에서 바꾼 값은 이 기기의 브라우저에 저장되며,
 * 여기 적힌 값보다 우선합니다.
 */
window.KIS = window.KIS || {};

KIS.CONFIG = {
  robotName: '피콕',
  robotNameEn: 'PEEKOK',
  title: '학교 안내 로봇',

  // 로봇이 서 있는 위치 (도면 좌표, js/data.js 와 같은 좌표계)
  robotLocation: { floor: 1, x: 325, y: 391, label: '1층 현관 로비' },

  idleTimeoutSec: 90,      // 아무 입력이 없으면 얼굴 화면으로 돌아가는 시간(초)
  faceCaptions: true,      // 얼굴 화면에서 가끔 자막으로 말 걸기 ("저를 터치하면 길을 안내해 드려요")
  voice: true,             // 음성 안내(TTS) 기본값
  voiceRate: 1.05,

  metersPerUnit: 0.24,     // 도면 1단위 ≈ 0.24m (교실 한 칸 ≈ 9m 기준)
  walkSpeed: 1.1,          // 걷는 속도 m/s
  secondsPerFloor: 20,     // 계단 한 층 오르내리는 시간(초)
  adminHoldMs: 3000,       // 관리자 화면을 여는 길게 누르기 시간
};
