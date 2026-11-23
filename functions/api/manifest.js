// GET /api/manifest?k=<로봇 키> — 로봇 화면용 웹앱 manifest
// 아이폰은 '홈 화면에 추가'한 앱이 사파리와 저장 공간(localStorage)을 나눠 쓰지 않아서, 사파리에서 등록한 로봇 키가
// 앱으로 넘어가지 않는다. 그래서 키를 가진 로봇 화면은 시작 주소에 #key= 를 담은 manifest 를 쓴다(# 뒤는 서버로 가지 않음).
// 키를 확인하거나 저장하지 않고 그대로 돌려줄 뿐이다.
const BASE = {
  name: '학교 안내 로봇 피콕',
  short_name: '피콕',
  description: '학교 안내 로봇 피콕의 얼굴 화면과 길 찾기',
  lang: 'ko',
  id: '/robot',
  scope: '/',
  display: 'standalone',
  display_override: ['fullscreen', 'standalone'],
  orientation: 'landscape',
  background_color: '#1A4FC0',
  theme_color: '#1A4FC0',
  icons: [
    { src: '/icons/icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};

export function onRequestGet({ request }) {
  const k = (new URL(request.url).searchParams.get('k') || '').trim().slice(0, 256);
  const m = Object.assign({}, BASE, { start_url: k ? `/robot#key=${encodeURIComponent(k)}` : '/robot' });
  return new Response(JSON.stringify(m), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
