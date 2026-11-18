/* /api/calls
 *   GET   로봇 화면: 열려 있는 호출 목록 (ROBOT_KEY 를 쓰면 x-robot-key 헤더 필요)
 *   POST  호출하기 { roomId, place, floor, note, name, pin } → { call, token }
 */
import { json, fail, storeOf, noStore, load, save, isRobot, newCall, publicView, robotView, readJson, OPEN, MAX_OPEN } from '../../../lib/calls.js';

export async function onRequestGet({ request, env }) {
  const kv = storeOf(env);
  if (!kv) return noStore();
  if (!isRobot(request, env)) return fail(401, '로봇 기기 키가 맞지 않아요.');
  const list = await load(kv);
  return json({ calls: list.filter((c) => OPEN.includes(c.status)).map(robotView), now: Date.now() });
}

export async function onRequestPost({ request, env }) {
  const kv = storeOf(env);
  if (!kv) return noStore();
  const body = await readJson(request);
  if (!body) return fail(400, '요청 내용을 읽지 못했어요.');
  if (env.CALL_PIN && String(body.pin || '').trim() !== String(env.CALL_PIN)) return fail(403, '학교 코드가 맞지 않아요.');

  const { call, error } = newCall(body);
  if (error) return fail(400, error);

  const list = await load(kv);
  if (list.filter((c) => OPEN.includes(c.status)).length >= MAX_OPEN) return fail(429, '지금은 호출이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
  list.push(call);
  await save(kv, list);
  return json({ call: publicView(call, list), token: call.token }, 201);
}
