/* /api/calls/:id
 *   GET    호출한 사람: 내 호출 상태 (?t=토큰) / 로봇: 키로 조회
 *   PATCH  상태 바꾸기 { status, t? }
 *          로봇: waiting → accepted → arrived → done, 언제든 canceled
 *          호출한 사람(토큰): waiting 일 때만 canceled
 */
import { json, fail, storeOf, noStore, load, save, isRobot, publicView, readJson, STATUSES } from '../../../lib/calls.js';

export async function onRequestGet({ request, env, params }) {
  const kv = storeOf(env);
  if (!kv) return noStore();
  const t = new URL(request.url).searchParams.get('t');
  const list = await load(kv);
  const call = list.find((c) => c.id === params.id);
  if (!call || (call.token !== t && !(env.ROBOT_KEY && isRobot(request, env)))) return fail(404, '호출을 찾지 못했어요. 시간이 오래 지나 정리되었을 수 있어요.');
  return json({ call: publicView(call, list) });
}

export async function onRequestPatch({ request, env, params }) {
  const kv = storeOf(env);
  if (!kv) return noStore();
  const body = await readJson(request);
  if (!body || !STATUSES.includes(body.status)) return fail(400, '바꿀 상태가 올바르지 않아요.');

  const list = await load(kv);
  const call = list.find((c) => c.id === params.id);
  if (!call) return fail(404, '호출을 찾지 못했어요.');

  const byCaller = body.t && body.t === call.token;
  if (byCaller) {
    if (body.status !== 'canceled') return fail(403, '호출 취소만 할 수 있어요.');
    if (call.status !== 'waiting') return fail(409, '로봇이 이미 출발해서 취소할 수 없어요.');
  } else if (!isRobot(request, env)) {
    return fail(401, '로봇 기기 키가 맞지 않아요.');
  }

  call.status = body.status;
  call.updatedAt = Date.now();
  if (byCaller) call.canceledBy = 'caller';
  await save(kv, list);
  return json({ call: publicView(call, list) });
}
