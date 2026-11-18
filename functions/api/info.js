/* /api/info — 호출 화면이 처음에 읽는 설정 (PIN 필요 여부, 저장소 연결 여부) */
import { json } from '../../lib/calls.js';

export function onRequestGet({ env }) {
  return json({ ready: !!(env && env.CALLS), pinRequired: !!(env && env.CALL_PIN), robotKeyRequired: !!(env && env.ROBOT_KEY) });
}
