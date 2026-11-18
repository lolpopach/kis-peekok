/* 로봇 상태 응답 (로봇 화면 · 로봇 제어 프로그램 공용) */
import { getRobot, waitingQueue, publicCall, isOnline } from './shared.js';

export async function robotState(db) {
  const robot = await getRobot(db);
  const call = robot.callId ? await db.prepare('SELECT * FROM calls WHERE id = ?').bind(robot.callId).first() : null;
  const queue = await waitingQueue(db);
  return {
    ok: true,
    robot: { ...robot, online: isOnline(robot) },
    call: publicCall(call),
    queue,
    now: Date.now(),
  };
}
