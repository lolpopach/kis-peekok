/* 장소 검색: 이름·별칭·초성·학년반 표현("5학년 1반", "5-1")·음성 문장("보건실 어디야?") */
window.KIS = window.KIS || {};

KIS.Search = (function () {
  const H = KIS.Hangul;
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s()[\]·,./?!~]/g, '');

  // 말로 물어본 문장에서 장소 이름만 남기기
  function clean(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/(어디(에|예)?\s*(있|인)?\s*(어요|어|나요|니|지|가요|요|야|에요|예요|죠)?|가는\s*(길|방법)|가고\s*싶(어요|어|은데|습니다)?|가려면|(좀\s*)?(알려|가르쳐|안내해|찾아)\s*(줘|주세요|줄래|줄래요|주실래요|줄\s*수\s*있어)?|위치|어떻게\s*가|찾고\s*있(어요|어|는데)|있나요|있어요)/g, ' ');
    s = s.replace(/[?!.~]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/(으로|에서|에|은|는|이|가|을|를|로)$/, '').trim();
    return s;
  }

  function classKey(raw) {
    const s = String(raw || '');
    let m = s.match(/(\d{1,2})\s*학년\s*(\d{1,2})\s*반/);
    if (!m) m = s.match(/^\s*(\d{1,2})\s*[-.\s]\s*(\d{1,2})\s*반?\s*$/);
    if (!m) m = s.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})/);
    return m ? `${Number(m[1])}-${Number(m[2])}` : null;
  }

  function search(raw, opts = {}) {
    const rooms = KIS.DATA.rooms().filter((r) => r.searchable);
    const text = opts.voice ? clean(raw) : String(raw || '').trim();
    const q = norm(text);
    const out = [];
    if (!q) return out;

    if (/화장실|화장|wc|토일렛|toilet/.test(q) || q === 'ㅎㅈㅅ') out.push({ special: 'restroom', score: 120 });
    if (/엘리베이터|엘베|승강기|elevator/.test(q)) out.push({ special: 'elevator', score: 119 });

    const ck = classKey(text);
    rooms.forEach((room) => {
      if (room.cat === 'restroom' || room.cat === 'elev') return;
      let score = 0;
      if (ck && room.group === 'class' && room.name === ck) score = 110;
      const cands = [[room.name, 0], [room.title, 3], ...room.aliases.map((a) => [a, 5])];
      cands.forEach(([c, pen]) => {
        if (!c) return;
        const n = norm(c);
        let s = 0;
        if (n === q) s = 100;
        else if (n.startsWith(q)) s = 82 - Math.min(10, n.length - q.length);
        else if (n.includes(q)) s = 62 - Math.min(10, n.length - q.length);
        else if (q.length >= 2 || H.isCons(q)) {
          const fi = H.fuzzyIndex(n, q);
          if (fi === 0) s = 52; else if (fi > 0) s = 44;
        }
        if (s) score = Math.max(score, s - pen);
      });
      // "5학년" → 5학년 교실 전체
      const gm = q.match(/^(\d{1,2})학년$/);
      if (gm && room.group === 'class' && room.grade === Number(gm[1])) score = Math.max(score, 90 - room.klass);
      if (q === '유치원' && room.group === 'class' && room.grade === 0) score = 95;
      if (score) out.push({ room, score });
    });

    out.sort((a, b) => b.score - a.score || ((a.room && a.room.floor) || 0) - ((b.room && b.room.floor) || 0));
    return out.slice(0, opts.limit || 40);
  }

  return { search, clean, classKey, norm };
})();
