/* venom-button.mjs – generated from venom-button.js by scripts/make-esm.js. Do not edit. */
const __venom = { exports: {} };
(function (module) {
/*!
 * VENOM Button  v1.0.0
 * A liquid "symbiote" link-button: a real <a href>, drawn with Canvas 2D. No dependencies.
 *
 *   <a href="/products" class="venom-button">ENTER HERE</a>
 *
 * Markup stays a plain link, so navigation never depends on this script.
 * The script only *enhances* it: it adds a transparent canvas (pointer-events: none),
 * wraps the label, and drives the animation.
 *
 * Per-element options (all optional)
 *   data-venom-cursor="over"    default – the system cursor is replaced only while it is over the button
 *   data-venom-cursor="zone"    original demo behaviour – cursor is hidden while the substance reaches for it
 *   data-venom-cursor="native"  never touch the cursor
 *   data-venom-reach="380"      max distance (px) the effect may extend beyond the button (advanced)
 *   data-venom-static           skip the animation, keep the static CSS look
 *
 * JS API:  VenomButton.init(root?) · create(el, opts?) · destroy(el) · get(el) · refresh() · auto(bool)
 *
 * The physics + drawing code below is the original VENOM engine; only the plumbing around it
 * (coordinates, canvas, events, lifecycle) was changed.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    // Bundlers (Next.js, Vite, webpack…): never auto-run, so server-rendered markup hydrates untouched.
    module.exports = api; api.default = api; api.VenomButton = api;
  } else {
    root.VenomButton = api;
    var cs = typeof document !== 'undefined' && document.currentScript;
    if (!cs || cs.getAttribute('data-auto') !== 'false') api.auto(true);
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

  // Server-side rendering / non-DOM environments: inert, import-safe.
  if (!IS_BROWSER) {
    var none = function () {};
    return { version: VERSION, supported: false, defaults: {}, create: function () { return null; }, init: function () { return []; }, destroy: none, get: function () { return null; }, refresh: none, auto: none };
  }

  /* ───────────────────────── constants ───────────────────────── */

  const SEL = '.venom-button';
  const STATE = 'data-venom-state';          // "live" | "fallback" | "static" | "off" (destroyed on purpose)
  const HIDE_ATTR = 'data-venom-hide-cursor';
  const ZONE_ATTR = 'data-venom-zone-cursor';
  const SMALL_PAD = 112;                     // canvas margin while idle (px)
  const MAX_DPR = 2;
  const CURSOR_SVG = '<svg class="venom-button__cursor" width="24" height="28" viewBox="0 0 24 28" aria-hidden="true" focusable="false"><path d="M1.5 1.5v20l5.2-4.8 3.6 8.4 3.5-1.5-3.6-8.2H17z" fill="#050506" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 7v10" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".5"/></svg>';

  /* ───────────────────────── original engine constants ───────────────────────── */

  const N = 14, K = 6, M = 72, ND = 24, NN = 5, TAU = Math.PI * 2;
  const { sin, cos, exp, hypot, atan2, min, max, abs, pow, random: rnd } = Math;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const lp = (a, b, t) => a + (b - a) * t;
  const ss = (a, b, v) => { const t = cl((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const F = n => new Float32Array(n);
  const RA = [-2.45, -1.5, -.7, .62, 1.55, 2.5], SP = [-.8, -.48, -.16, .16, .48, .8], IL = [.4, .3, .45, 1, 1.25, 1];

  let RM = false;                            // prefers-reduced-motion (shared by all instances)

  /* sprites: soft glints, contact shadow, reflection band (shared, created once) */
  let GL, SH, BD;
  function makeSprites() {
    if (GL) return;
    const spr = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d')); return c; };
    const rad = s => spr(64, 64, g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); s.forEach((c, i) => r.addColorStop(i / (s.length - 1), c)); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
    GL = rad(['rgba(255,255,255,1)', 'rgba(255,255,255,.45)', 'rgba(255,255,255,0)']);
    SH = rad(['rgba(0,0,0,.6)', 'rgba(0,0,0,.25)', 'rgba(0,0,0,0)']);
    BD = spr(64, 8, g => { const r = g.createLinearGradient(0, 0, 64, 0); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(.5, '#fff'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 8); });
  }

  /* ════════════════════════════════════════════════════════════════════
   *  THE ENGINE  (original VENOM physics + drawing, one closure per button)
   *
   *  All coordinates are relative to the CENTRE of the button: (0,0) is the middle of the
   *  body. Moving / resizing the canvas therefore never disturbs the simulation.
   * ════════════════════════════════════════════════════════════════════ */
  function createEngine(CV, X, L, CU, host) {
    /* state (all typed arrays preallocated; nothing allocated per frame) */
    const bx = F(M), by = F(M), bnx = F(M), bny = F(M), ba = F(M), bd = F(M), bv = F(M), qx = F(M), qy = F(M);
    const tx = F(K * N), ty = F(K * N), ox = F(K * N), oy = F(K * N), SG = F(K), AX = F(K), AY = F(K), GX = F(K), GY = F(K), HI = F(K), NX = F(N), NY = F(N), WJ = F(N);
    const Da = new Uint8Array(ND), Dx = F(ND), Dy = F(ND), Dvx = F(ND), Dvy = F(ND), Dr = F(ND), Dd = F(ND);
    const P = { x: 0, y: 0, px: 0, py: 0, sp: 0, in: 0, touch: 0, ux: 1, uy: 0 }, bl = { x: 0, y: 0, vx: 0, vy: 0 };
    const cx = 0, cy = 0;
    let cw = 0, ch = 0, dpr = 1, ccx = 0, ccy = 0, hw = 130, hh = 40, run = 0, last = 0, T = 0, quiet = 0, act = 0, fo = 0, fc = 0, al = 0, hu = 0, cu = 0, en = 0, pr = 0, prv = 0, prT = 0, pu = 0, va = 0, lx = 0, ly = 0, hid = 0, ls = '', lo = -1, sA = .5, gB, gR, ready = 0;
    const rr = a => pow(pow(abs(cos(a)) / hw, NN) + pow(abs(sin(a)) / hh, NN), -1 / NN);
    const gl = (x, y, a, b, o) => { X.globalAlpha = o; X.drawImage(GL, x - a / 2, y - b / 2, a, b); };

    const api = {
      dR: 9e3, on: false,
      geom, canvasSize, setPointer, step, redraw: render, busy,
      kick, stop() { run = 0; },
      running() { return run; },
      down, up, click() { pu = 1; kick(); },
      focus(v) { fo = v ? 1 : 0; if (!v) up(); kick(); }
    };

    /* body geometry + gradients (depends only on the button's size) */
    function geom(bw, bh) {
      hw = bw / 2 - 3; hh = bh / 2 - 3;
      for (let i = 0; i < M; i++) {
        const a = i / M * TAU, q = rr(a), x = cos(a) * q, y = sin(a) * q; bx[i] = x; by[i] = y; ba[i] = a;
        const nx = (x < 0 ? -1 : 1) * pow(abs(x / hw), NN - 1) / hw, ny = (y < 0 ? -1 : 1) * pow(abs(y / hh), NN - 1) / hh, l = hypot(nx, ny) || 1; bnx[i] = nx / l; bny[i] = ny / l;
      }
      gB = X.createRadialGradient(cx - hw * .3, cy - hh * 1.2, 2, cx, cy, hw * 1.2); gB.addColorStop(0, '#1a1a1e'); gB.addColorStop(.45, '#09090b'); gB.addColorStop(1, '#020203');
      gR = X.createLinearGradient(cx - hw, 0, cx + hw, 0); [[0, 0], [.14, .95], [.42, .2], [.72, .75], [1, 0]].forEach(s => gR.addColorStop(s[0], 'rgba(255,255,255,' + s[1] + ')'));
      if (!ready) { ready = 1; for (let i = 0; i < K * N; i++) { tx[i] = ox[i] = cx; ty[i] = oy[i] = cy; } }
    }
    /* canvas backing store: css size, where the button centre sits inside it, device pixel ratio */
    function canvasSize(w, h, centreX, centreY, d) {
      cw = w; ch = h; ccx = centreX; ccy = centreY; dpr = d;
      const pw = Math.round(w * d), ph = Math.round(h * d);
      if (CV.width !== pw) CV.width = pw;
      if (CV.height !== ph) CV.height = ph;
    }
    function setPointer(on, x, y, touch) {
      if (!on || !P.in) { P.px = x; P.py = y; }
      P.in = on ? 1 : 0; P.touch = touch ? 1 : 0; P.x = x; P.y = y;
    }
    function place() { CU.style.transform = 'translate3d(' + (P.x + ccx - 1.5) + 'px,' + (P.y + ccy - 1.5) + 'px,0) scale(' + sA.toFixed(3) + ')'; }
    function kick() { quiet = 0; if (!run && host.canRun()) { run = 1; last = performance.now(); host.wake(); } }
    /* true while anything is drawn farther out than the idle canvas margin */
    function busy() {
      if (act || hu > .001 || cu > .03) return true;
      for (let i = 0; i < ND; i++) if (Da[i]) return true;
      for (let i = 0; i < K; i++) if (HI[i] > .001) return true;
      return false;
    }

    /* droplets */
    function spawn(x, y, vx, vy, r, dl) { for (let i = 0; i < ND; i++) if (!Da[i]) { Da[i] = 1; Dx[i] = x; Dy[i] = y; Dvx[i] = vx; Dvy[i] = vy; Dr[i] = r; Dd[i] = dl; return; } }
    function burst() { if (RM) return; for (let i = 0; i < K; i++) { const o = i * N; for (let j = 4; j < N; j += 4) if (rnd() < .5) spawn(tx[o + j], ty[o + j], (tx[o + j] - ox[o + j]) * 30 + rnd() * 60 - 30, (ty[o + j] - oy[o + j]) * 30 + rnd() * 60 - 30, 1.5 + rnd() * 2.3, .04 + rnd() * .22); } }
    function stepD(dt) {
      for (let i = 0; i < ND; i++) {
        if (!Da[i]) continue;
        const free = Dd[i] > 0;
        if (free) { Dd[i] -= dt; Dvy[i] += 400 * dt; } else { const dx = cx - Dx[i], dy = cy - Dy[i], d = hypot(dx, dy) || 1; Dvx[i] += dx / d * 1500 * dt; Dvy[i] += dy / d * 1500 * dt; }
        Dvx[i] *= .985; Dvy[i] *= .985; Dx[i] += Dvx[i] * dt; Dy[i] += Dvy[i] * dt;
        const ex = Dx[i] - cx, ey = Dy[i] - cy;
        if (!free && pow(abs(ex) / hw, NN) + pow(abs(ey) / hh, NN) < .9) { Da[i] = 0; bv[((atan2(ey, ex) / TAU + 1) % 1 * M) | 0] += 45 + Dr[i] * 14; }
      }
    }

    /* body: ring of coupled springs gives travelling ripples */
    function stepBody(dt) {
      const on = al > .01 && !RM, pa = atan2(P.uy, P.ux);
      for (let i = 0; i < M; i++) {
        const l = bd[(i + 1) % M] + bd[(i + M - 1) % M] - 2 * bd[i]; let f = -95 * bd[i] - 6 * bv[i] + 900 * l;
        if (on) { let d = ba[i] - pa; d = atan2(sin(d), cos(d)); f += al * (exp(-d * d * 1.6) * 1100 * (P.in ? 1 : 0) + (1 - hu) * sin(T * 8 + i * .9) * 140); }
        bv[i] += f * dt;
      }
      for (let i = 0; i < M; i++) bd[i] += bv[i] * dt;
    }
    function stepBlob(dt) {
      const gx = P.x + 5, gy = P.y + 7;
      if (!act && cu < .05) { bl.x = gx; bl.y = gy; bl.vx = bl.vy = 0; return; }
      bl.vx += ((gx - bl.x) * 520 - bl.vx * 13) * dt; bl.vy += ((gy - bl.y) * 520 - bl.vy * 13) * dt; bl.x += bl.vx * dt; bl.y += bl.vy * dt;
    }

    /* tendrils: Verlet chains, anchored to the body, tip sprung to its target */
    function chain(i, dt) {
      const o = i * N, ax = AX[i], ay = AY[i], hi = HI[i], gx = GX[i], gy = GY[i], dx = gx - ax, dy = gy - ay, dist = hypot(dx, dy) || 1, nx = -dy / dist, ny = dx / dist;
      const sg = cl(dist * (1.015 + .16 * (1 - P.sp) * (1 - hi * .4)) / (N - 1), .9, 26);
      SG[i] += (sg - SG[i]) * min(1, dt * (hi > .5 ? 18 : 28));
      const k = lp(1500, 850, hi), g = lp(520, 130, hi), am = lp(120, 900, hi) * (1 - P.sp * .7), s0 = SG[i], d2 = dt * dt;
      tx[o] = ax; ty[o] = ay;
      for (let j = 1; j < N; j++) {
        const q = o + j, x = tx[q], y = ty[q], vx = (x - ox[q]) * .9, vy = (y - oy[q]) * .9; ox[q] = x; oy[q] = y;
        const s = sin(T * 2.4 + i * 2.1 + j * .6) * am * sin(j / N * 3.1416); let fx = nx * s, fy = ny * s + g;
        if (j === N - 1) { fx += k * (gx - x); fy += k * (gy - y); }
        tx[q] = x + vx + fx * d2; ty[q] = y + vy + fy * d2;
      }
      for (let it = 0; it < 5; it++) for (let j = 1; j < N; j++) {
        const a = o + j - 1, b = a + 1, ex = tx[b] - tx[a], ey = ty[b] - ty[a], d = hypot(ex, ey) || 1e-4, f = (d - s0) / d;
        if (j === 1) { tx[b] -= ex * f; ty[b] -= ey * f; } else { const m = f * .5; tx[a] += ex * m; ty[a] += ey * m; tx[b] -= ex * m; ty[b] -= ey * m; }
      }
    }

    /* ---------- drawing ---------- */
    function ribbon(i) {
      const o = i * N, hi = HI[i]; let len = 0;
      for (let j = 0; j < N; j++) {
        const a = o + (j > 0 ? j - 1 : 0), b = o + (j < N - 1 ? j + 1 : N - 1), dx = tx[b] - tx[a], dy = ty[b] - ty[a], l = hypot(dx, dy) || 1;
        NX[j] = -dy / l; NY[j] = dx / l; if (j) len += hypot(tx[o + j] - tx[o + j - 1], ty[o + j] - ty[o + j - 1]);
      }
      const bw = 24 * cl(80 / (len + 28), .2, 1) * (.42 + .58 * hi) * (1 - .5 * P.sp * hi) * (1 + .35 * pu), tb = .5 + .28 * sin(T * .9 + i * 1.9), be = .9 * (1 - P.sp * .7) * (.5 + .5 * hi);
      for (let j = 0; j < N; j++) { const t = j / (N - 1), d = t - tb; WJ[j] = max(1.1, 1.5 + (bw - 1.5) * pow(1 - t, 2 + .8 * hi) + bw * .8 * exp(-t * t * 60) + be * exp(-d * d / .005) * (2.4 + .07 * bw)); }
      X.beginPath();
      let x = tx[o] + NX[0] * WJ[0] / 2, y = ty[o] + NY[0] * WJ[0] / 2; X.moveTo(x, y);
      for (let j = 1; j < N; j++) { const x1 = tx[o + j] + NX[j] * WJ[j] / 2, y1 = ty[o + j] + NY[j] * WJ[j] / 2; X.quadraticCurveTo(x, y, (x + x1) / 2, (y + y1) / 2); x = x1; y = y1; }
      X.lineTo(x, y); x = tx[o + N - 1] - NX[N - 1] * WJ[N - 1] / 2; y = ty[o + N - 1] - NY[N - 1] * WJ[N - 1] / 2; X.lineTo(x, y);
      for (let j = N - 2; j >= 0; j--) { const x1 = tx[o + j] - NX[j] * WJ[j] / 2, y1 = ty[o + j] - NY[j] * WJ[j] / 2; X.quadraticCurveTo(x, y, (x + x1) / 2, (y + y1) / 2); x = x1; y = y1; }
      X.closePath(); X.fill();
      X.beginPath(); X.arc(tx[o + N - 1], ty[o + N - 1], max(WJ[N - 1] * .5, (1 - hi) * (2 + al * 1.5)), 0, TAU); X.fill();
      X.strokeStyle = '#fff'; X.lineCap = 'round';
      for (let j = 2; j < N - 1; j++) {
        const wj = WJ[j]; if (wj < 3.6) continue;
        const t = j / (N - 1), a = (.5 + .5 * sin(T * 1.6 - t * 8 + i * 2.3)) * .62 * cl((wj - 3) / 5, 0, 1); if (a < .04) continue;
        const sd = (NX[j] * -.5 + NY[j] * -.86) > 0 ? .26 : -.26, p = o + j;
        X.globalAlpha = a; X.lineWidth = max(.8, wj * .11);
        X.beginPath(); X.moveTo(tx[p - 1] + NX[j - 1] * wj * sd, ty[p - 1] + NY[j - 1] * wj * sd); X.lineTo(tx[p] + NX[j] * wj * sd, ty[p] + NY[j] * wj * sd); X.stroke();
      }
      X.globalAlpha = 1;
    }
    function webs() {
      X.strokeStyle = '#040405'; X.lineCap = 'round';
      for (let i = 0; i < K - 1; i++) {
        const a = HI[i] * HI[i + 1]; if (a < .05) continue;
        for (let m = 0; m < 2; m++) {
          const p = i * N + (m ? 8 : 4), q = (i + 1) * N + (m ? 8 : 5), x0 = tx[p], y0 = ty[p], x1 = tx[q], y1 = ty[q], d = hypot(x1 - x0, y1 - y0); if (d > 170) continue;
          X.globalAlpha = a; X.lineWidth = max(.6, 2.3 - d * .016) * (1 - P.sp * .5);
          X.beginPath(); X.moveTo(x0, y0); X.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 5 + d * .08 * (1 - P.sp), x1, y1); X.stroke();
        }
      }
      X.globalAlpha = 1;
    }
    function rim(a, b, ins, lw, o) {
      const s = a * M | 0, e = b * M | 0; X.beginPath(); X.globalAlpha = o; X.lineWidth = lw;
      for (let i = s; i <= e; i++) { const k = ins * (1 + .15 * sin(T * .8 + i * .4)), x = qx[i] - bnx[i] * k, y = qy[i] - bny[i] * k; i === s ? X.moveTo(x, y) : X.lineTo(x, y); }
      X.stroke();
    }
    function bodyD() {
      const sc = 1 - .07 * pr;
      for (let i = 0; i < M; i++) {
        const a = ba[i], d = bd[i] + (RM ? 0 : 2.1 * sin(3 * a + T * .35) + 1.5 * sin(5 * a - T * .27 + 1) + .9 * sin(9 * a + T * .5 + 2) + al * 1.4 * sin(7 * a + T * 5));
        qx[i] = cx + (bx[i] + bnx[i] * d) * sc; qy[i] = cy + (by[i] + bny[i] * d) * sc;
      }
      X.beginPath(); X.moveTo((qx[M - 1] + qx[0]) / 2, (qy[M - 1] + qy[0]) / 2);
      for (let i = 0; i < M; i++) { const n = (i + 1) % M; X.quadraticCurveTo(qx[i], qy[i], (qx[i] + qx[n]) / 2, (qy[i] + qy[n]) / 2); }
      X.closePath(); X.fillStyle = gB; X.fill();
      X.save(); X.clip();
      gl(cx - hw * .25 + sin(T * .22) * hw * .3, cy - hh * .58, hw * 1.25, hh * .7, .2 + .06 * sin(T * .5));
      X.globalAlpha = .08; X.drawImage(BD, cx - hw + ((T * .045) % 1.5 - .25) * hw * 2, cy - hh * 1.3, hw * .5, hh * 2.6);
      X.strokeStyle = gR; X.lineCap = 'round'; X.lineJoin = 'round';
      rim(.57, .93, 7, 2.2, .8 + .15 * sin(T * .7)); rim(.06, .44, 5, 1.3, .22);
      for (let k = 0; k < 3; k++) gl(cx + hw * (-.55 + .5 * k) + sin(T * .3 + k * 2) * 14, cy - hh * .62 + cos(T * .25 + k) * 3, 12 + k * 5, 5, .5);
      if (al > .05) { const i = ((atan2(P.uy, P.ux) / TAU + 1) % 1 * M) | 0; gl(qx[i] - bnx[i] * 9, qy[i] - bny[i] * 9, 28, 16, al * .6); }
      X.restore(); X.globalAlpha = 1;
    }
    function dropD() {
      X.fillStyle = '#040405';
      for (let i = 0; i < ND; i++) if (Da[i]) { const r = Dr[i]; X.globalAlpha = 1; X.beginPath(); X.arc(Dx[i], Dy[i], r, 0, TAU); X.fill(); gl(Dx[i] - r * .3, Dy[i] - r * .3, r * 1.5, r * 1.5, .75); }
      X.globalAlpha = 1;
    }
    function blobD() {
      if (cu < .03) return;
      const Rb = cu * (9 + 13 * en) * (1 + .5 * pu), s = P.sp;
      X.save(); X.translate(bl.x, bl.y); X.rotate(va); X.scale(1 + s * .9, 1 - s * .3); X.beginPath();
      for (let k = 0; k <= 32; k++) { const a = k / 32 * TAU, r = Rb * (1 + .09 * sin(a * 3 + T * 5) + .06 * sin(a * 5 - T * 3.7)); k ? X.lineTo(cos(a) * r, sin(a) * r) : X.moveTo(r, 0); }
      X.closePath(); X.fillStyle = '#040405'; X.fill(); X.restore();
      gl(bl.x - Rb * .3, bl.y - Rb * .4, Rb * .9, Rb * .55, .7 * cu); X.globalAlpha = 1;
    }
    function render() {
      // transparent canvas: clear instead of the original opaque white fill; origin = button centre
      X.setTransform(dpr, 0, 0, dpr, dpr * ccx, dpr * ccy); X.globalAlpha = 1; X.clearRect(-ccx, -ccy, cw, ch);
      X.globalAlpha = .14 * (1 - .25 * pr); X.drawImage(SH, cx - hw * 1.1, cy + hh * .3, hw * 2.2, hh * 1.6); X.globalAlpha = 1;
      X.fillStyle = '#040405';
      if (!RM) { for (let i = 0; i < K; i++) ribbon(i); webs(); }
      bodyD(); dropD(); blobD();
    }

    /* ---------- one animation step ---------- */
    function step(now) {
      try {
        const dt = cl((now - last) / 1000, .001, 1 / 30), rm = RM; last = now; T += dt;
        const inz = !!(P.in && !rm);
        const ddx = P.x - P.px, ddy = P.y - P.py, v = hypot(ddx, ddy) / dt; P.px = P.x; P.py = P.y;
        P.sp += (cl(v / 2000, 0, 1) - P.sp) * min(1, dt * 8); if (v > 60) va = atan2(ddy, ddx);
        const dR = inz ? hypot(max(abs(P.x - cx) - hw, 0), max(abs(P.y - cy) - hh, 0)) : 9e3;
        const want = inz && dR < (P.touch ? 340 : act ? 290 : 250) ? 1 : 0;
        if (want !== act) { act = want; if (!act) burst(); }
        if (inz) { const l = hypot(P.x - cx, P.y - cy) || 1; P.ux += ((P.x - cx) / l - P.ux) * min(1, dt * 10); P.uy += ((P.y - cy) / l - P.uy) * min(1, dt * 10); }
        fc += ((fo ? 1 : 0) - fc) * min(1, dt * 4);
        al += (max(inz ? ss(440, 130, dR) : 0, fc * .7) - al) * min(1, dt * 5);
        hu += (act - hu) * min(1, dt * (act ? 6 : 5)); cu += (act - cu) * min(1, dt * (act ? 9 : 7));
        en += ((act ? ss(235, 20, dR) : 0) - en) * min(1, dt * 6); pu *= exp(-dt * 3);
        prv += ((prT - pr) * 420 - prv * 20) * dt; pr += prv * dt;
        // native cursor: hidden only while the substance holds it (and, in the default mode, only over the button)
        let hd = act && cu > .35 && !P.touch ? 1 : 0;
        if (host.mode === 'native') hd = 0; else if (host.mode === 'over' && !host.hover) hd = 0;
        if (hd !== hid) { hid = hd; host.hideCursor(!!hd); }
        const Rb = cu * (9 + 13 * en) * (1 + .5 * pu), pa = atan2(P.uy, P.ux);
        if (!rm) {
          for (let i = 0; i < K; i++) {
            const hi = ss(0, 1, hu * 1.5 - i * .09); HI[i] = hi;
            let ux = cos(RA[i]), uy = sin(RA[i]);
            if (hi > 0) { const a = pa + SP[i] * (1 - .4 * en); ux = lp(ux, cos(a), hi); uy = lp(uy, sin(a), hi); const l = hypot(ux, uy) || 1; ux /= l; uy /= l; }
            const q = rr(atan2(uy, ux)) - 7; AX[i] = cx + ux * q; AY[i] = cy + uy * q;
            const Li = (10 + 6 * sin(T * .7 + i * 1.3)) * IL[i] * (1 + al * 2.4 + fc * 1.2), f = i / K * TAU + T * (i & 1 ? 1.1 : -.9), ro = max(2, Rb * .5);
            GX[i] = lp(AX[i] + ux * Li + (inz ? (P.x - AX[i]) * al * .05 : 0), bl.x + cos(f) * ro, hi);
            GY[i] = lp(AY[i] + uy * Li + 4 * IL[i] + (inz ? (P.y - AY[i]) * al * .05 : 0), bl.y + sin(f) * ro, hi);
          }
          if (act && P.sp > .6 && rnd() < dt * 5) spawn(bl.x - cos(va) * 10, bl.y - sin(va) * 10, -cos(va) * 120 + rnd() * 80 - 40, -sin(va) * 120 + rnd() * 80 - 40, 1.4 + rnd() * 1.8, .15);
        }
        const ns = 2, sd = dt / ns;
        for (let s = 0; s < ns; s++) { stepBody(sd); if (!rm) for (let i = 0; i < K; i++) chain(i, sd); stepD(sd); stepBlob(sd); }
        sA = lp(.5, 1, ss(0, .6, cu));
        const o = (P.touch || rm || host.mode === 'native' || (host.mode === 'over' && !host.hover)) ? 0 : cl(cu * 2.2, 0, 1);
        if (o !== lo) { lo = o; CU.style.opacity = o; }
        if (o > 0) place();
        lx += ((inz ? cl((P.x - cx) * .012, -2.2, 2.2) * al : 0) - lx) * min(1, dt * 6); ly += ((inz ? cl((P.y - cy) * .012, -1.2, 1.2) * al : 0) - ly) * min(1, dt * 6);
        const s = 'translate(' + lx.toFixed(2) + 'px,' + ly.toFixed(2) + 'px) scale(' + (1 - .035 * pr).toFixed(3) + ')'; if (s !== ls) { ls = s; L.style.transform = s; }
        render();
        api.dR = dR; api.on = inz;
        if (rm && ++quiet > 80) run = 0;
      } catch (e) { run = 0; host.fail(e); }
    }

    /* ---------- press feedback ---------- */
    function down() { if (prT) return; prT = 1; pu = 1; for (let i = 0; i < M; i++) bv[i] -= 55; kick(); }
    function up() {
      if (!prT) return; prT = 0; prv += 7; pu = 1; for (let i = 0; i < M; i++) bv[i] += 85 * (.6 + .4 * sin(i * .5));
      if (!RM) for (let i = 0; i < 5; i++) { const a = rnd() * TAU, r = rr(a), s = 160 + rnd() * 160; spawn(cx + cos(a) * r, cy + sin(a) * r, cos(a) * s, sin(a) * s, 1.6 + rnd() * 2, .08 + rnd() * .12); }
      kick();
    }

    return api;
  }

  /* ════════════════════════════════════════════════════════════════════
   *  LAYOUT SAFETY
   *  The effect canvas extends past the button. Anything that extends past the end of the
   *  document (or of a scrolling container) would add scrollbars / blank scroll space, so
   *  the canvas is clamped to the room that really exists. Space beyond that is off-page
   *  and invisible anyway, so nothing visible is lost.
   * ════════════════════════════════════════════════════════════════════ */
  function findClippers(el) {
    let xc = null, yc = null;
    for (let p = el.parentElement; p && !(xc && yc); p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!xc && cs.overflowX !== 'visible') xc = { p, o: cs.overflowX };
      if (!yc && cs.overflowY !== 'visible') yc = { p, o: cs.overflowY };
    }
    return [xc, yc];
  }
  function measureRooms(v) {
    const el = v.el, docEl = document.documentElement, se = document.scrollingElement || docEl;
    // hide every effect layer while measuring: neither this button's nor a stale neighbour's canvas may inflate the numbers
    const all = list.indexOf(v) < 0 ? list.concat(v) : list, saved = all.map(x => [x.canvas.style.display, x.layer.style.display]);
    all.forEach(x => { x.canvas.style.display = 'none'; x.layer.style.display = 'none'; });
    const r = el.getBoundingClientRect(), out = { l: Infinity, t: Infinity, r: Infinity, b: Infinity };
    const cl2 = findClippers(el), scrolls = c => !c || c.o === 'auto' || c.o === 'scroll' || c.o === 'overlay', isView = c => !c || c.p === docEl || c.p === document.body;
    if (scrolls(cl2[0])) {
      const box = isView(cl2[0]) ? null : cl2[0].p;
      const sw = box ? box.scrollWidth : se.scrollWidth, cwid = box ? box.clientWidth : se.clientWidth, sl = box ? box.scrollLeft : window.scrollX;
      const u = r.left - (box ? box.getBoundingClientRect().left + box.clientLeft : 0) + sl;
      if (getComputedStyle(box || docEl).direction === 'rtl') out.l = u + (sw - cwid) - 1; else out.r = sw - (u + r.width) - 1;
    }
    if (scrolls(cl2[1])) {
      const box = isView(cl2[1]) ? null : cl2[1].p;
      const sh = box ? box.scrollHeight : se.scrollHeight, st = box ? box.scrollTop : window.scrollY;
      out.b = sh - (r.top - (box ? box.getBoundingClientRect().top + box.clientTop : 0) + st + r.height) - 1;
    }
    all.forEach((x, i) => { x.canvas.style.display = saved[i][0]; x.layer.style.display = saved[i][1]; });
    return out;
  }
  const pad = (target, room) => Math.floor(max(0, min(target, room)));

  /* ════════════════════════════════════════════════════════════════════
   *  ONE BUTTON
   * ════════════════════════════════════════════════════════════════════ */
  const registry = new WeakMap();   // element -> instance
  const list = [];                  // all live instances
  const zoneHiders = new Set();

  class Venom {
    constructor(el, o) {
      this.el = el; this.mode = o.cursor; this.reach = o.reach;
      this.dead = false; this.failed = false; this.live = false; this.visible = true; this.hover = false;
      this.sized = false; this.dirty = false; this.w = 0; this.h = 0; this.dpr = 1; this.px = 0; this.py = 0;
      this.wide = false; this.calm = 0; this.rooms = null; this.curHidden = false; this.tick = 0; this.rl = 0; this.rt = 0; this.sx = 0; this.sy = 0;
      this.offs = []; this.created = []; this.wrapped = false;
    }

    /* build / adopt the three layers: canvas (under), label, pointer layer (over) */
    build() {
      const el = this.el, kids = Array.from(el.children);
      const find = c => kids.find(k => k.classList.contains(c));
      let label = find('venom-button__label'), canvas = find('venom-button__canvas'), layer = find('venom-button__pointer');
      if (!label) {
        label = document.createElement('span'); label.className = 'venom-button__label';
        Array.from(el.childNodes).forEach(n => { if (n !== canvas && n !== layer) label.appendChild(n); });
        el.appendChild(label); this.wrapped = true;
      }
      if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'venom-button__canvas'; canvas.setAttribute('aria-hidden', 'true'); el.insertBefore(canvas, el.firstChild); this.created.push(canvas); }
      if (!layer) { layer = document.createElement('span'); layer.className = 'venom-button__pointer'; layer.setAttribute('aria-hidden', 'true'); el.appendChild(layer); this.created.push(layer); }
      let cursor = layer.querySelector('.venom-button__cursor');
      if (!cursor) { layer.insertAdjacentHTML('beforeend', CURSOR_SVG); cursor = layer.querySelector('.venom-button__cursor'); }
      this.label = label; this.canvas = canvas; this.layer = layer; this.cursor = cursor;
      let ctx = null; try { ctx = canvas.getContext('2d'); } catch (e) { /* ignore */ }
      if (!ctx) return false;
      makeSprites();
      this.engine = createEngine(canvas, ctx, label, cursor, this);
      return true;
    }

    /* put the element's markup back the way the author wrote it */
    restoreDom() {
      this.created.forEach(n => n.parentNode && n.parentNode.removeChild(n));
      if (this.wrapped && this.label) {
        while (this.label.firstChild) this.el.insertBefore(this.label.firstChild, this.label);
        if (this.label.parentNode) this.label.parentNode.removeChild(this.label);
      }
      if (this.canvas && this.created.indexOf(this.canvas) < 0) this.canvas.style.cssText = '';   // adopted (e.g. React-rendered) layers keep existing, minus our inline sizing
      if (this.layer && this.created.indexOf(this.layer) < 0) this.layer.style.cssText = '';
    }

    /* host interface used by the engine */
    canRun() { return !this.dead && !this.failed && this.sized && this.visible && !document.hidden; }
    wake() { wake(); }
    hideCursor(b) { this.setCursorHidden(b); }
    fail(err) {
      if (this.failed) return; this.failed = true;
      try { console.error('[venom-button] animation stopped, showing the static button instead:', err); } catch (e) { /* ignore */ }
      this.engine.stop(); this.setCursorHidden(false);
      this.canvas.style.display = 'none'; this.layer.style.display = 'none';
      this.el.setAttribute(STATE, 'fallback');
    }
    setCursorHidden(b) {
      if (b === this.curHidden) return; this.curHidden = b;
      if (this.mode === 'zone') { b ? zoneHiders.add(this) : zoneHiders.delete(this); document.documentElement.toggleAttribute(ZONE_ATTR, zoneHiders.size > 0); }
      else this.el.toggleAttribute(HIDE_ATTR, b);
    }
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); this.offs.push(() => target.removeEventListener(type, fn, opts)); }

    start() {
      const el = this.el, e = this.engine;
      this.on(el, 'focus', () => { let v = 1; try { v = el.matches(':focus-visible') ? 1 : 0; } catch (_) { /* old browsers: treat as visible */ } e.focus(v); });
      this.on(el, 'blur', () => e.focus(0));
      this.on(el, 'keydown', ev => { if (ev.key === 'Enter' && !ev.repeat) e.down(); });
      this.on(el, 'keyup', ev => { if (ev.key === 'Enter') e.up(); });
      this.on(el, 'click', () => e.click());
      this.on(el, 'pointerenter', () => { this.hover = true; });
      this.on(el, 'pointerleave', () => { this.hover = false; });
      if (io) io.observe(el);
      if (ro) ro.observe(el);
      this.relayout();
    }

    /* measure → size the canvas → (re)build body geometry. Returns false when the element has no box. */
    layout() {
      this.dirty = false;
      if (this.failed || this.dead) return false;
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      if (!w || !h) { this.sized = false; this.engine.stop(); return false; }
      this.sized = true;
      this.dpr = min(window.devicePixelRatio || 1, MAX_DPR);
      if (w !== this.w || h !== this.h) { this.w = w; this.h = h; this.engine.geom(w, h); }
      this.applyPads(true);
      if (!this.live) { this.live = true; this.el.setAttribute(STATE, 'live'); }
      return true;
    }
    relayout() { if (this.layout()) this.engine.kick(); }

    /* canvas = button + a margin on every side (small when idle, large when the pointer is near) */
    applyPads(remeasure) {
      const target = this.wide ? this.reach : min(this.reach, SMALL_PAD);
      if (remeasure || !this.rooms) this.rooms = measureRooms(this);
      const R = this.rooms, pl = pad(target, R.l), pt = pad(target, R.t), pr = pad(target, R.r), pb = pad(target, R.b);
      const cssW = this.w + pl + pr, cssH = this.h + pt + pb;
      const geo = s => { s.left = -pl + 'px'; s.top = -pt + 'px'; s.width = cssW + 'px'; s.height = cssH + 'px'; };
      geo(this.canvas.style); geo(this.layer.style);
      this.engine.canvasSize(cssW, cssH, pl + this.w / 2, pt + this.h / 2, this.dpr);
      this.engine.redraw();               // never leave a cleared canvas on screen
    }
    setWide(on) { this.wide = on; this.calm = 0; this.applyPads(on); }

    /* frame phase 1 – reads only */
    read() {
      if (++this.tick % 30 === 0 && this.sized) {
        // drift check (~2×/s): did layout move the button without resizing it? (carousel, sidebar, transform…) then the edge clamp is stale
        const r = this.el.getBoundingClientRect(), sx = window.scrollX, sy = window.scrollY;
        if (sx === this.sx && sy === this.sy && (abs(r.left - this.rl) > .5 || abs(r.top - this.rt) > .5)) this.dirty = true;
        this.sx = sx; this.sy = sy; this.rl = r.left; this.rt = r.top;
      }
      if (this.dirty || min(window.devicePixelRatio || 1, MAX_DPR) !== this.dpr) this.layout();
      if (!this.sized) return;
      const on = ptr.in && !RM;
      let x = this.px, y = this.py;
      if (on) {
        const r = this.el.getBoundingClientRect();
        const kx = r.width > 0 && abs(r.width - this.w) > 1.5 ? this.w / r.width : 1, ky = r.height > 0 && abs(r.height - this.h) > 1.5 ? this.h / r.height : 1;   // CSS-transformed ancestors
        x = (ptr.x - (r.left + r.width / 2)) * kx; y = (ptr.y - (r.top + r.height / 2)) * ky;
        this.px = x; this.py = y;
      }
      this.engine.setPointer(on, x, y, ptr.touch);
    }
    /* frame phase 2 – physics, drawing, DOM writes */
    update(now) {
      const e = this.engine; e.step(now);
      if (this.dead || this.failed || !this.sized) return;
      const near = e.on && e.dR < (this.wide ? 470 : 400);
      if (near || e.busy()) { this.calm = 0; if (!this.wide) this.setWide(true); }
      else if (this.wide && ++this.calm > 40) this.setWide(false);
    }

    setVisible(b) {
      this.visible = b;
      if (b) { this.layout(); this.engine.kick(); }          // always re-measure: the layout may have changed while paused
      else { this.engine.stop(); this.setCursorHidden(false); }
    }

    /* final=true (explicit destroy): element stays a plain static link until create() is called again.
       final=false (automatic, element left the DOM): attribute cleared so it re-enhances if re-inserted. */
    destroy(final) {
      if (this.dead) return; this.dead = true;
      this.engine.stop(); this.setCursorHidden(false);
      this.offs.forEach(f => f()); this.offs.length = 0;
      if (io) io.unobserve(this.el);
      if (ro) ro.unobserve(this.el);
      registry.delete(this.el); const i = list.indexOf(this); if (i > -1) list.splice(i, 1);
      this.canvas.width = this.canvas.height = 0;          // release the backing store (Safari keeps it otherwise)
      this.label.style.transform = '';
      this.restoreDom();
      if (final) this.el.setAttribute(STATE, 'off'); else this.el.removeAttribute(STATE);
      this.el.removeAttribute(HIDE_ATTR);
      if (!list.length) teardownGlobals();
    }
    refresh() { this.dirty = true; if (!this.engine.running()) this.relayout(); else this.engine.kick(); }
  }

  /* ════════════════════════════════════════════════════════════════════
   *  SHARED LOOP + GLOBAL LISTENERS (one of each, however many buttons exist)
   * ════════════════════════════════════════════════════════════════════ */
  const ptr = { x: 0, y: 0, in: false, touch: false, hold: 0 };
  const live = [];                  // scratch array reused each frame
  const offs = [];
  let raf = 0, globalsOn = false, io = null, ro = null, rmQuery = null;

  function wake() { if (!raf && !document.hidden) raf = requestAnimationFrame(loop); }
  function loop(now) {
    raf = 0; live.length = 0;
    for (let i = 0; i < list.length; i++) if (list[i].engine.running()) live.push(list[i]);
    if (!live.length) return;
    if (ptr.touch && ptr.in && now > ptr.hold) ptr.in = false;       // finger lifted: let the substance retract
    try {
      for (let i = 0; i < live.length; i++) { try { live[i].read(now); } catch (e) { live[i].fail(e); } }
      for (let i = 0; i < live.length; i++) if (!live[i].failed && !live[i].dead) live[i].update(now);
    } finally {
      if (!raf) for (let i = 0; i < live.length; i++) if (live[i].engine.running()) { raf = requestAnimationFrame(loop); break; }
    }
  }
  const wakeAll = () => { for (let i = 0; i < list.length; i++) list[i].engine.kick(); };
  let invalidating = 0;
  function invalidateAll() {
    for (let i = 0; i < list.length; i++) list[i].dirty = true;
    if (invalidating) return;
    invalidating = requestAnimationFrame(() => {            // coalesced: one pass per frame, even while a window is being dragged
      invalidating = 0;
      list.slice().forEach(v => { if (!v.dead && v.dirty && !v.engine.running()) v.relayout(); });   // paused ones too; running ones re-measure in their own frame
      wakeAll();
    });
  }
  const stopAll = () => { cancelAnimationFrame(raf); raf = 0; for (let i = 0; i < list.length; i++) { list[i].engine.stop(); list[i].setCursorHidden(false); } };

  function onMove(e) {
    if (RM) return;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.in = true; ptr.touch = e.pointerType === 'touch';
    if (ptr.touch) ptr.hold = performance.now() + 1300;
    wakeAll();
  }
  function onDown(e) { onMove(e); for (let i = 0; i < list.length; i++) if (list[i].el.contains(e.target)) list[i].engine.down(); }
  function onUp() { for (let i = 0; i < list.length; i++) list[i].engine.up(); }
  function onCancel(e) { if (e.pointerType === 'touch') ptr.in = false; onUp(); }     // touch turned into a scroll: retract
  function onOut(e) { if (!e.relatedTarget && !ptr.touch) ptr.in = false; }           // pointer left the window
  function onBlur() { ptr.in = false; onUp(); }
  function onVis() { if (document.hidden) { stopAll(); ptr.in = false; onUp(); } else wakeAll(); }
  function onShow(e) { if (e.persisted) wakeAll(); }
  function onResize() { invalidateAll(); wakeAll(); }
  function onIntersect(entries) {
    for (let i = 0; i < entries.length; i++) {
      const v = registry.get(entries[i].target); if (!v) continue;
      if (!v.el.isConnected) { v.destroy(); continue; }
      v.setVisible(entries[i].isIntersecting);
    }
  }
  function onResizeObs(entries) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].target === document.documentElement) { invalidateAll(); continue; }   // page size changed
      const v = registry.get(entries[i].target); if (!v) continue;
      if (v.engine.running()) v.dirty = true; else v.relayout();
    }
  }

  function setupGlobals() {
    if (globalsOn) return; globalsOn = true;
    const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };
    rmQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    RM = !!(rmQuery && rmQuery.matches);
    if (rmQuery) {
      const f = e => { RM = e.matches; if (RM) ptr.in = false; wakeAll(); };
      if (rmQuery.addEventListener) { rmQuery.addEventListener('change', f); offs.push(() => rmQuery.removeEventListener('change', f)); }
      else if (rmQuery.addListener) { rmQuery.addListener(f); offs.push(() => rmQuery.removeListener(f)); }
    }
    add(window, 'pointermove', onMove, { passive: true });
    add(window, 'pointerdown', onDown, { passive: true });
    add(window, 'pointerup', onUp);
    add(window, 'pointercancel', onCancel);
    add(document, 'mouseout', onOut);
    add(window, 'blur', onBlur);
    add(document, 'visibilitychange', onVis);
    add(window, 'pagehide', stopAll);
    add(window, 'pageshow', onShow);
    add(window, 'resize', onResize);
    if (typeof IntersectionObserver !== 'undefined') io = new IntersectionObserver(onIntersect, { rootMargin: '400px' });
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResizeObs); ro.observe(document.documentElement); }
    add(window, 'load', invalidateAll);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (globalsOn) invalidateAll(); });   // web fonts change text metrics → layout
  }
  function teardownGlobals() {
    if (!globalsOn) return; globalsOn = false;
    offs.forEach(f => f()); offs.length = 0;
    if (io) { io.disconnect(); io = null; }
    if (ro) { ro.disconnect(); ro = null; }
    cancelAnimationFrame(raf); raf = 0; cancelAnimationFrame(invalidating); invalidating = 0; ptr.in = false;
    document.documentElement.removeAttribute(ZONE_ATTR); zoneHiders.clear();
  }

  /* ════════════════════════════════════════════════════════════════════
   *  PUBLIC API
   * ════════════════════════════════════════════════════════════════════ */
  function supported() { try { return !!document.createElement('canvas').getContext('2d'); } catch (e) { return false; } }

  function readOptions(el, o) {
    const d = api.defaults, ds = el.dataset || {};
    let cursor = (o && o.cursor) || ds.venomCursor || d.cursor;
    if (cursor !== 'over' && cursor !== 'zone' && cursor !== 'native') cursor = 'over';
    const reach = cl(+((o && o.reach) || ds.venomReach || d.reach) || 380, 60, 640);
    return { cursor, reach };
  }

  function create(el, o) {
    if (!el || el.nodeType !== 1) return null;
    const known = registry.get(el); if (known) return known;
    if (el.hasAttribute('data-venom-static') || (o && o.static)) { el.setAttribute(STATE, 'static'); return null; }
    const v = new Venom(el, readOptions(el, o));
    if (!supported() || !v.build()) {                        // no canvas: the CSS keeps it a working, good-looking link
      v.restoreDom(); el.setAttribute(STATE, 'fallback'); return null;
    }
    registry.set(el, v); list.push(v);
    setupGlobals();
    v.start();
    return v;
  }
  function init(scope, o) {
    const s = scope || document, out = [], nodes = [];
    if (s.nodeType === 1 && s.matches(SEL)) nodes.push(s);
    if (s.querySelectorAll) Array.prototype.push.apply(nodes, s.querySelectorAll(SEL));
    nodes.forEach(el => { if (!registry.has(el)) { const v = create(el, o); if (v) out.push(v); } });
    return out;
  }
  function destroy(target) { const v = target && target.engine ? target : registry.get(target); if (v) v.destroy(true); }

  /* auto mode: enhance every .venom-button now, and any that is added later; clean up removed ones */
  let mo = null, autoOn = false;
  function scanNew() { document.querySelectorAll(SEL).forEach(el => { if (!registry.has(el) && !el.hasAttribute(STATE)) create(el); }); }
  function sweep() { list.slice().forEach(v => { if (!v.el.isConnected) v.destroy(); }); }
  function auto(on) {
    if (on === false) { autoOn = false; if (mo) { mo.disconnect(); mo = null; } return; }
    if (autoOn) return; autoOn = true;
    const go = () => {
      if (!autoOn) return;
      scanNew();
      if (typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(recs => {
          let added = false, removed = false;
          for (let i = 0; i < recs.length; i++) { if (recs[i].addedNodes.length) added = true; if (recs[i].removedNodes.length) removed = true; }
          if (removed) sweep();
          if (added) scanNew();
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
  }

  const api = {
    version: VERSION,
    get supported() { return supported(); },
    defaults: { cursor: 'over', reach: 380 },
    create, init, destroy, auto,
    get(el) { return registry.get(el) || null; },
    refresh() { list.forEach(v => v.refresh()); }
  };
  return api;
}));

}).call(typeof globalThis !== 'undefined' ? globalThis : this, __venom);
export default __venom.exports;
export const VenomButton = __venom.exports;
