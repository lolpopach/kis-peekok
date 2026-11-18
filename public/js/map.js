/* 층별 지도 (SVG) — 방 그리기, 경로 표시, 확대·이동 */
window.KIS = window.KIS || {};

KIS.MapView = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const D = KIS.DATA;
  const DEBUG = /[?&]debug=1/.test(location.search);
  let uid = 0;

  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null) n.setAttribute(k, v); });
    if (parent) parent.appendChild(n);
    return n;
  };
  const textWidth = (s) => Array.from(s).reduce((w, ch) => w + (/[가-힣ㄱ-ㅣ]/.test(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.52), 0);

  function labelLines(room) {
    if (room.label) return room.label.split('\n');
    if (room.group === 'class') return [room.name];
    return room.name.replace(/\s\(/, '\n(').split('\n');
  }

  class MapView {
    constructor(host, opts = {}) {
      this.host = host;
      this.opts = opts;
      this.u = `m${++uid}`;
      host.classList.add('map-stage');
      this.svg = el('svg', { class: 'map-svg', preserveAspectRatio: 'xMidYMid meet', role: 'img' });
      host.appendChild(this.svg);
      this.defs();
      this.base = el('g', { class: 'map-base' }, this.svg);
      this.overlay = el('g', { class: 'map-overlay' }, this.svg);
      this.bindGestures();
    }

    defs() {
      const d = el('defs', {}, this.svg);
      const g = el('pattern', { id: `${this.u}-garden`, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, d);
      el('rect', { width: 6, height: 6, fill: '#D5ECCB' }, g);
      el('path', { d: 'M0 6L6 0M-1 1L1 -1M5 7L7 5M0 0L6 6', stroke: '#B8DCAA', 'stroke-width': 0.8 }, g);
      const o = el('pattern', { id: `${this.u}-open`, width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, d);
      el('rect', { width: 5, height: 5, fill: '#EFF1F4' }, o);
      el('path', { d: 'M5 0V5H0', fill: 'none', stroke: '#DDE2E8', 'stroke-width': 0.5 }, o);
    }

    /* ── 층 그리기 ── */
    setFloor(fid, { keepView = false } = {}) {
      this.floorId = Number(fid);
      this.floor = D.floorById(fid);
      this.base.textContent = '';
      this.overlay.textContent = '';
      this.roomEls = {};
      const f = this.floor;
      const b = this.base;
      const R = (r, attrs) => el('rect', Object.assign({ x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] }, attrs), b);

      f.open.forEach((r) => R(r, { fill: `url(#${this.u}-open)` }));
      f.gardens.forEach((r) => R(r, { fill: `url(#${this.u}-garden)` }));
      f.voids.forEach((r) => {
        R(r, { fill: '#FBFCFD', stroke: '#C9D0D9', 'stroke-width': 0.5 });
        el('path', { d: `M${r[0]} ${r[1]}L${r[2]} ${r[3]}M${r[2]} ${r[1]}L${r[0]} ${r[3]}`, stroke: '#D3D9E1', 'stroke-width': 0.5 }, b);
      });
      f.corridors.forEach((r) => R(r, { fill: '#FFF3D4' }));
      (f.trees || []).forEach(([x, y]) => this.tree(x, y));

      f.rooms.forEach((room) => this.drawRoom(room));
      // 계단 아이콘
      Object.values(f.nodes).forEach((n) => {
        if (n[2] === 'stair') this.glyph('stairs', n[0], n[1], 8.5, '#3B4656');
      });
      if (DEBUG) this.drawDebug();
      if (!keepView) this.setView(this.baseBox(), false);
    }

    baseBox() { const v = this.floor.viewBox; return { x: v[0], y: v[1], w: v[2], h: v[3] }; }

    tree(x, y) {
      const g = el('g', { class: 'map-tree', transform: `translate(${x} ${y})` }, this.base);
      el('rect', { x: -1.6, y: 2, width: 3.2, height: 12, rx: 1, fill: '#9A6B45' }, g);
      [[-7, -2, 8], [6, -3, 8], [0, -9, 9], [-1, 1, 8]].forEach(([cx, cy, r]) => el('circle', { cx, cy, r, fill: '#7CC36A', opacity: 0.9 }, g));
      el('circle', { cx: 2, cy: -6, r: 4, fill: '#9AD487', opacity: 0.9 }, g);
    }

    glyph(name, x, y, size, color, parent) {
      const g = el('g', { transform: `translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`, class: 'map-glyph' }, parent || this.base);
      g.innerHTML = KIS.ICONS[name];
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', color);
      g.setAttribute('stroke-width', '2.2');
      g.setAttribute('stroke-linecap', 'round');
      g.setAttribute('stroke-linejoin', 'round');
      return g;
    }

    drawRoom(room) {
      const g = el('g', { class: `room cat-${room.cat}`, 'data-room': room.searchable ? room.id : null }, this.base);
      room.rects.forEach((r) => el('rect', { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], class: 'room-shape' }, g));
      this.roomEls[room.id] = g;
      const r = room.rect;
      const c = KIS.Router.roomCenter(room);
      const w = r[2] - r[0], h = r[3] - r[1];
      if (room.cat === 'restroom') { this.glyph('restroom', c[0], c[1], Math.min(14, w - 2, h - 2), '#5B6777', g); return; }
      if (room.cat === 'elev') { this.glyph('elevator', c[0], c[1], Math.min(12, w - 3, h - 3), '#263241', g); return; }
      if (room.cat === 'neutral') return;
      if (room.cat === 'entrance') {
        const t = el('text', { x: c[0], y: c[1] + 0.3, class: 'room-label', 'font-size': 7.5, 'dominant-baseline': 'central', 'text-anchor': 'middle' }, g);
        t.textContent = '▲ 현관';
        return;
      }
      const lines = labelLines(room);
      const lw = Math.max(...lines.map(textWidth));
      const vertical = lines.length > 2 && lines.every((l) => l.length <= 2) && h > w * 1.3;
      const avail = room.labelAt ? 60 : w - 3;
      let fs = Math.min(8.6, avail / Math.max(lw, 1), (h - 3) / (lines.length * 1.18));
      if (room.group === 'class') fs = Math.min(10, avail / Math.max(lw, 1), (h - 4) / 1.2);
      fs = Math.max(fs, vertical ? 4.5 : 3.6);
      const t = el('text', { x: c[0], y: c[1], class: 'room-label', 'font-size': fs.toFixed(2), 'text-anchor': 'middle' }, g);
      const lh = fs * 1.16;
      lines.forEach((line, i) => {
        const ts = el('tspan', { x: c[0], y: (c[1] - ((lines.length - 1) * lh) / 2 + i * lh).toFixed(2), 'dominant-baseline': 'central' }, t);
        ts.textContent = line;
      });
    }

    drawDebug() {
      const g = el('g', { class: 'map-debug' }, this.base);
      const Rt = KIS.Router.debug;
      (Rt.floorEdges[this.floorId] || []).forEach(([a, b]) => {
        const na = Rt.nodes[a], nb = Rt.nodes[b];
        if (na && nb) el('line', { x1: na.x, y1: na.y, x2: nb.x, y2: nb.y, stroke: '#E0179B', 'stroke-width': 0.8 }, g);
      });
      Object.entries(this.floor.nodes).forEach(([id, n]) => {
        el('circle', { cx: n[0], cy: n[1], r: 1.6, fill: n[2] ? '#E0179B' : '#fff', stroke: '#E0179B', 'stroke-width': 0.6 }, g);
        const t = el('text', { x: n[0] + 2, y: n[1] - 2, 'font-size': 4, fill: '#B0127A' }, g);
        t.textContent = id;
      });
      this.floor.rooms.filter((r) => r.searchable).forEach((room) => {
        KIS.Router.roomDoors(room).forEach((d) => {
          el('line', { x1: d.pt[0], y1: d.pt[1], x2: d.doorPt[0], y2: d.doorPt[1], stroke: '#1F6FE0', 'stroke-width': 0.8 }, g);
          el('circle', { cx: d.doorPt[0], cy: d.doorPt[1], r: 1.2, fill: '#1F6FE0' }, g);
        });
      });
    }

    /* ── 강조 · 경로 ── */
    clearOverlay() {
      this.overlay.textContent = '';
      Object.values(this.roomEls || {}).forEach((g) => g.classList.remove('is-target', 'is-picked'));
    }

    highlight(roomId, cls = 'is-target') {
      const g = this.roomEls[roomId];
      if (g) g.classList.add(cls);
    }

    pill(x, y, text, cls, anchor = 'middle') {
      const fs = 6.4, pad = 3.4;
      const w = textWidth(text) * fs + pad * 2, h = fs + pad * 1.7;
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      const g = el('g', { class: `map-pill ${cls || ''}` }, this.overlay);
      el('rect', { x: x0, y: y - h / 2, width: w, height: h, rx: h / 2 }, g);
      const t = el('text', { x: x0 + w / 2, y: y + 0.3, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = text;
      return { x0, w, h };
    }

    you(x, y, label) {
      const g = el('g', { class: 'map-you', transform: `translate(${x} ${y})` }, this.overlay);
      el('circle', { r: 11, class: 'map-you-pulse' }, g);
      el('circle', { r: 5.4, class: 'map-you-dot' }, g);
      if (label) this.pill(x + 9, y, label, 'pill-you', 'start');
    }

    showRoute(seg, ctx) {
      this.clearOverlay();
      if (ctx.room && ctx.room.floor === this.floorId) this.highlight(ctx.room.id);
      const pts = seg.draw;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
      el('path', { d, class: 'route-casing' }, this.overlay);
      el('path', { d, class: 'route-line' }, this.overlay);
      el('path', { d, class: 'route-flow' }, this.overlay);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const walker = el('circle', { r: 3.6, class: 'route-walker' }, this.overlay);
      const am = el('animateMotion', { dur: `${Math.max(2.4, len / 45).toFixed(2)}s`, repeatCount: 'indefinite', path: d, rotate: 'auto' }, walker);
      am.beginElement && setTimeout(() => { try { am.beginElement(); } catch (e) { /* noop */ } }, 0);

      const first = pts[0], last = pts[pts.length - 1];
      if (ctx.isFirst) this.you(first[0], first[1], ctx.youLabel || '현재 위치');
      else this.pill(first[0], first[1] - 9, `${ctx.prevFloor}층에서 ${ctx.prevFloor < this.floorId ? '올라옴' : '내려옴'}`, 'pill-info');
      if (seg.via) {
        this.glyph(seg.via.type === 'elev' ? 'elevator' : 'stairs', seg.via.x, seg.via.y, 10, '#FF5A1F', this.overlay);
        this.pill(seg.via.x, seg.via.y - 11, `${seg.via.toFloor}층으로 ${seg.via.toFloor > this.floorId ? '▲' : '▼'}`, 'pill-go');
      }
      if (ctx.room && ctx.room.floor === this.floorId) {
        const c = KIS.Router.roomCenter(ctx.room);
        const pin = el('g', { class: 'map-pin', transform: `translate(${c[0]} ${c[1]})` }, this.overlay);
        const inner = el('g', { class: 'map-pin-bob' }, pin);
        el('path', { d: 'M0 0c-5-6-9-9.4-9-14a9 9 0 0 1 18 0c0 4.6-4 8-9 14z', class: 'map-pin-shape' }, inner);
        el('circle', { cx: 0, cy: -14, r: 3.4, fill: '#fff' }, inner);
      }
      return { last };
    }

    flash(x, y) {
      const c = el('circle', { cx: x, cy: y, r: 6, class: 'map-flash' }, this.overlay);
      setTimeout(() => c.remove(), 1600);
    }

    /* ── 보기 영역 ── */
    setView(v, animate = true) {
      const base = this.baseBox();
      const minW = base.w / 6;
      v = Object.assign({}, v);
      if (v.w < minW) { const k = minW / v.w; v.x -= (v.w * (k - 1)) / 2; v.y -= (v.h * (k - 1)) / 2; v.w *= k; v.h *= k; }
      if (v.w > base.w * 1.4) { const k = (base.w * 1.4) / v.w; v.x += (v.w * (1 - k)) / 2; v.y += (v.h * (1 - k)) / 2; v.w *= k; v.h *= k; }
      // 도면 밖으로 너무 나가지 않게
      const mx = v.w * 0.5, my = v.h * 0.5;
      v.x = Math.min(Math.max(v.x, base.x - mx), base.x + base.w - v.w + mx);
      v.y = Math.min(Math.max(v.y, base.y - my), base.y + base.h - v.h + my);
      const apply = (q) => this.svg.setAttribute('viewBox', `${q.x.toFixed(2)} ${q.y.toFixed(2)} ${q.w.toFixed(2)} ${q.h.toFixed(2)}`);
      cancelAnimationFrame(this.anim);
      if (!animate || !this.view || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.view = v; apply(v); return; }
      const from = Object.assign({}, this.view), t0 = performance.now(), dur = 420;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        const q = { x: from.x + (v.x - from.x) * e, y: from.y + (v.y - from.y) * e, w: from.w + (v.w - from.w) * e, h: from.h + (v.h - from.h) * e };
        apply(q);
        if (k < 1) this.anim = requestAnimationFrame(step); else this.view = v;
      };
      this.view = v;
      this.anim = requestAnimationFrame(step);
    }

    fit(points, pad = 26, minW = 180) {
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
      let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
      // 화면 비율 맞추기
      const box = this.svg.getBoundingClientRect();
      const ar = box.width && box.height ? box.width / box.height : 1.5;
      let w = Math.max(x1 - x0, minW), h = Math.max(y1 - y0, minW / ar);
      if (w / h < ar) w = h * ar; else h = w / ar;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // 도면 바깥 빈 곳이 보이지 않게 가능한 한 도면 안쪽으로 밀어 넣는다
      const base = this.baseBox();
      const inside = (v, size, b0, bSize) => (size <= bSize ? Math.min(Math.max(v, b0), b0 + bSize - size) : b0 + (bSize - size) / 2);
      this.setView({ x: inside(cx - w / 2, w, base.x, base.w), y: inside(cy - h / 2, h, base.y, base.h), w, h }, false);
    }

    reset() { this.setView(this.baseBox()); }

    zoomBy(k, cx, cy) {
      const v = this.view;
      if (cx === undefined) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
      this.setView({ x: cx - (cx - v.x) / k, y: cy - (cy - v.y) / k, w: v.w / k, h: v.h / k }, false);
    }

    toUser(clientX, clientY) {
      const m = this.svg.getScreenCTM();
      if (!m) return [0, 0];
      const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
      return [p.x, p.y];
    }

    // 지도는 고정: 끌기·확대 없이 누르기만 받는다 (방 누르기 → onRoomTap, 빈 곳 누르기 → onMapTap)
    bindGestures() {
      this.svg.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('[data-room]');
        if (g && this.opts.onRoomTap) this.opts.onRoomTap(g.getAttribute('data-room'));
        else if (this.opts.onMapTap) this.opts.onMapTap(this.toUser(e.clientX, e.clientY));
      });
    }
  }

  return MapView;
})();
