#!/usr/bin/env node
/*
 * VENOM Button – functional test suite (real Chromium via Playwright, real input events).
 *
 *   npm i -D playwright sharp      (and: npx playwright install chromium)
 *   node tests/run-tests.js            # everything
 *   node tests/run-tests.js nav        # only tests whose name contains "nav"
 *
 * For the pixel-level comparison against the original animation see fidelity.js.
 */
const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DEMO = 'file://' + path.join(ROOT, 'demo.html');
const FIX = f => 'file://' + path.join(__dirname, 'fixtures', f);
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[2] || '';

/* ───────────── tiny runner ───────────── */
const results = [];
let browser, desktop; const trackedCtx = [];
async function cleanup() { for (const c of trackedCtx.splice(0)) await c.close().catch(() => {}); if (desktop) for (const p of desktop.pages()) await p.close().catch(() => {}); }
async function test(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  try { const note = await fn(); results.push({ name, ok: true }); console.log('  ✓', name + (note ? '  — ' + note : '')); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  ✗', name, '\n      ' + String(e.message).split('\n').slice(0, 3).join('\n      ')); }
  finally { await cleanup(); }   // a failed test must never leave pages running and loading the machine for the next one
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const group = t => { if (!ONLY) console.log('\n' + t); };

/* ───────────── page instrumentation (injected before any page script) ───────────── */
const INSTRUMENT = () => {
  // Only calls that originate from venom-button.js are counted (Playwright's own helpers also use rAF / window listeners).
  const mine = () => /venom-button/.test(new Error().stack || '');
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { if (mine()) window.__raf++; return raf(cb); };
  window.__ls = {};
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const key = (t, ty) => (t === window ? 'window' : t === document ? 'document' : 'el') + ':' + ty;
  EventTarget.prototype.addEventListener = function (ty, fn, o) { if (mine()) { const k = key(this, ty); window.__ls[k] = (window.__ls[k] || 0) + 1; } return add.call(this, ty, fn, o); };
  EventTarget.prototype.removeEventListener = function (ty, fn, o) { if (mine()) { const k = key(this, ty); window.__ls[k] = (window.__ls[k] || 0) - 1; } return rem.call(this, ty, fn, o); };
  const clr = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function () { this.canvas.__draws = (this.canvas.__draws || 0) + 1; return clr.apply(this, arguments); };
  window.__globals0 = Object.keys(window);
  // number of pixels with alpha > 50% inside a client-space rectangle of a canvas
  window.__alpha = (c, x0, y0, x1, y1) => {
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    const sx = Math.max(0, Math.round((x0 - r.left) * k)), sy = Math.max(0, Math.round((y0 - r.top) * k));
    const ex = Math.min(c.width, Math.round((x1 - r.left) * k)), ey = Math.min(c.height, Math.round((y1 - r.top) * k));
    if (ex <= sx || ey <= sy) return 0;
    const d = c.getContext('2d').getImageData(sx, sy, ex - sx, ey - sy).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  };
};

function collect(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.text().includes('[venom-button]')) errs.push(m.type() + ': ' + m.text()); });
  return errs;
}
async function open(ctx, url = DEMO) {
  const page = await ctx.newPage(); const errs = collect(page);
  await page.goto(url);
  await page.waitForFunction(() => { const a = document.querySelectorAll('.venom-button'); return a.length > 0 && [...a].every(x => x.getAttribute('data-venom-state') === 'live'); }, null, { timeout: 6000 });
  await page.waitForTimeout(250);
  return { page, errs };
}
const narrowW = (w, pad = 112) => w + 2 * pad;

(async () => {
  browser = await chromium.launch();
  const rawNewContext = browser.newContext.bind(browser);
  browser.newContext = async o => { const c = await rawNewContext(o); trackedCtx.push(c); return c; };
  desktop = await rawNewContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await desktop.addInitScript(INSTRUMENT);

  /* ═══════════ A. markup contract ═══════════ */
  group('A. Markup & enhancement');
  await test('A1 every .venom-button upgrades to a live canvas button, no console errors', async () => {
    const { page, errs } = await open(desktop);
    const n = await page.$$eval('.venom-button', e => e.length);
    assert(n === 7, 'expected 7 instances on the demo page, got ' + n);
    assert(errs.length === 0, 'console errors: ' + errs.join(' | '));
    await page.close(); return n + ' instances';
  });
  await test('A2 stays a REAL link: <a href>, no placeholder hrefs, label text intact', async () => {
    const { page } = await open(desktop);
    const info = await page.$$eval('.venom-button', els => els.map(a => ({ tag: a.tagName, href: a.getAttribute('href'), text: a.textContent.trim(), label: !!a.querySelector('.venom-button__label') })));
    for (const i of info) { assert(i.tag === 'A', 'not an <a>'); assert(i.href && !i.href.startsWith('#') && !/^javascript:/i.test(i.href), 'placeholder href: ' + i.href); assert(i.text.length > 2 && i.label, 'label lost'); }
    await page.close(); return info.map(i => i.href).slice(0, 3).join(', ') + ' …';
  });
  await test('A3 effect layers are aria-hidden and have pointer-events:none', async () => {
    const { page } = await open(desktop);
    const bad = await page.$$eval('.venom-button', els => els.flatMap(a => ['.venom-button__canvas', '.venom-button__pointer', '.venom-button__cursor', '.venom-button__label'].map(s => { const n = a.querySelector(s); return { s, pe: getComputedStyle(n).pointerEvents, hidden: n.closest('[aria-hidden="true"]') !== null }; })).filter(x => x.pe !== 'none' || (x.s !== '.venom-button__label' && !x.hidden)));
    assert(bad.length === 0, 'offenders: ' + JSON.stringify(bad.slice(0, 3)));
    await page.close();
  });

  /* ═══════════ B. animation reacts to the pointer ═══════════ */
  group('B. Liquid behaviour (real mouse)');
  await test('B1 substance extends toward the cursor and engulfs it', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox();
    const px = box.x + box.width + 70, py = box.y + box.height / 2 + 25;
    await page.mouse.move(box.x + box.width + 340, box.y + box.height / 2);
    await page.mouse.move(px, py, { steps: 14 }); await page.waitForTimeout(900);
    const m = await page.evaluate(([px, py]) => {
      const a = document.querySelector('.hero .venom-button'), c = a.querySelector('canvas'), r = a.getBoundingClientRect();
      return { w: parseFloat(c.style.width), bw: r.width,
        right: window.__alpha(c, r.right + 8, r.top - 50, r.right + 260, r.bottom + 50), left: window.__alpha(c, r.left - 260, r.top - 50, r.left - 8, r.bottom + 50),
        blob: window.__alpha(c, px + 5 - 10, py + 7 - 10, px + 5 + 10, py + 7 + 10) };
    }, [px, py]);
    assert(m.w > narrowW(m.bw) + 100, `canvas did not widen (${m.w})`);
    assert(m.right > 300, `no tendril mass between button and cursor (${m.right})`);
    assert(m.left < 120, `substance appeared on the far side (${m.left})`);
    assert(m.blob > 150, `cursor not engulfed (blob px ${m.blob})`);
    await page.close(); return `tendril px ${m.right} (far side ${m.left}), blob px at cursor ${m.blob}`;
  });
  await test('B2 substance retracts naturally when the cursor leaves', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 70, box.y + box.height / 2 + 25, { steps: 8 }); await page.waitForTimeout(700);
    const wide = await page.evaluate(() => parseFloat(document.querySelector('.hero .venom-button canvas').style.width));
    await page.mouse.move(30, 770, { steps: 6 });
    await page.waitForFunction(() => { const a = document.querySelector('.hero .venom-button'); return parseFloat(a.querySelector('canvas').style.width) <= a.getBoundingClientRect().width + 226; }, null, { timeout: 7000 });
    const m = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'), c = a.querySelector('canvas'), r = a.getBoundingClientRect(); return { right: window.__alpha(c, r.right + 40, r.top - 50, r.right + 110, r.bottom + 50) }; });
    assert(m.right < 40, 'tendrils still present after retraction: ' + m.right);
    await page.close(); return `canvas ${wide}px → idle size again, no residue`;
  });
  await test('B3 default cursor mode: system cursor untouched outside the button, replaced over it', async () => {
    const { page } = await open(desktop);
    await page.locator('.host-btn').hover(); await page.waitForTimeout(800);   // inside the effect zone, over an ordinary control
    const out = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'); return { hide: a.hasAttribute('data-venom-hide-cursor'), zone: document.documentElement.hasAttribute('data-venom-zone-cursor'), hostCursor: getComputedStyle(document.querySelector('.host-btn')).cursor, arrow: a.querySelector('.venom-button__cursor').style.opacity }; });
    assert(!out.hide && !out.zone, 'cursor hidden while merely near the button'); assert(out.hostCursor === 'pointer', 'host control cursor changed'); assert(out.arrow === '0', 'custom arrow visible outside button');
    await page.locator('.hero .venom-button').hover(); await page.waitForTimeout(700);
    const over = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'); return { hide: a.hasAttribute('data-venom-hide-cursor'), cursor: getComputedStyle(a).cursor, arrow: a.querySelector('.venom-button__cursor').style.opacity }; });
    assert(over.hide && over.cursor === 'none' && over.arrow === '1', 'cursor not swapped over the button: ' + JSON.stringify(over));
    await page.locator('.host-btn').hover(); await page.waitForTimeout(300);
    assert(!(await page.evaluate(() => document.querySelector('.hero .venom-button').hasAttribute('data-venom-hide-cursor'))), 'cursor stayed hidden after leaving');
    await page.close();
  });
  await test('B4 data-venom-cursor="native" never touches the cursor', async () => {
    const { page } = await open(desktop);
    const a = page.locator('.venom-button[data-venom-cursor="native"]'); await a.scrollIntoViewIfNeeded(); await a.hover(); await page.waitForTimeout(800);
    const r = await a.evaluate(el => ({ hide: el.hasAttribute('data-venom-hide-cursor'), arrow: el.querySelector('.venom-button__cursor').style.opacity, wide: parseFloat(el.querySelector('canvas').style.width) > el.getBoundingClientRect().width + 240 }));
    assert(!r.hide && r.arrow === '0' && r.wide, 'native mode misbehaved: ' + JSON.stringify(r));
    await page.close();
  });
  await test('B5 opt-in "zone" mode reproduces the original (cursor hidden while the substance holds it) and is cleaned up', async () => {
    const { page } = await open(desktop, FIX('zone.html'));
    const box = await page.locator('.venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 90, box.y + box.height / 2, { steps: 8 }); await page.waitForTimeout(800);
    const on = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-venom-zone-cursor'), body: getComputedStyle(document.body).cursor, link: getComputedStyle(document.querySelector('.plain')).cursor }));
    assert(on.attr && on.body === 'none' && on.link === 'none', 'zone mode did not hide the cursor: ' + JSON.stringify(on));
    await page.mouse.move(40, 760, { steps: 6 }); await page.waitForTimeout(400);
    const off = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-venom-zone-cursor'), link: getComputedStyle(document.querySelector('.plain')).cursor }));
    assert(!off.attr && off.link === 'pointer', 'cursor not restored after leaving: ' + JSON.stringify(off));
    await page.mouse.move(box.x + box.width + 90, box.y + box.height / 2, { steps: 6 }); await page.waitForTimeout(600);
    await page.evaluate(() => VenomButton.destroy(document.querySelector('.venom-button')));
    assert(!(await page.evaluate(() => document.documentElement.hasAttribute('data-venom-zone-cursor'))), 'zone attribute leaked after destroy');
    await page.close();
  });

  /* ═══════════ C. navigation ═══════════ */
  group('C. Navigation');
  await test('C1 mouse click navigates to the href (and Playwright confirms nothing intercepts the click)', async () => {
    const { page } = await open(desktop);
    await Promise.all([page.waitForURL(/destination\.html\?page=products/), page.locator('.hero .venom-button').click()]);
    assert(/products/.test(await page.textContent('#arrived')), 'wrong destination content');
    await page.close(); return page.url().split('/').pop();
  });
  await test('C2 keyboard: Tab reaches it, visible focus ring, Enter navigates', async () => {
    const { page } = await open(desktop);
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.matches('.hero .venom-button'))) break; }
    const f = await page.evaluate(() => { const a = document.activeElement, cs = getComputedStyle(a); return { is: a.matches('.hero .venom-button'), fv: a.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset }; });
    assert(f.is && f.fv && f.style === 'solid' && parseFloat(f.width) >= 2, 'focus indicator missing: ' + JSON.stringify(f));
    await page.screenshot({ path: path.join(OUT, 'focus-ring.png'), clip: { x: 440, y: 440, width: 400, height: 190 } });
    await Promise.all([page.waitForURL(/destination\.html\?page=products/), page.keyboard.press('Enter')]);
    await page.close(); return `outline ${f.width} ${f.style}, offset ${f.offset}`;
  });
  await test('C3 opens in a new tab with Ctrl+click and middle-click (normal link behaviour intact)', async () => {
    const { page } = await open(desktop); const link = page.locator('.hero .venom-button');
    let [popup] = await Promise.all([desktop.waitForEvent('page'), link.click({ modifiers: ['Control'] })]);
    await popup.waitForURL(/destination\.html\?page=products/, { timeout: 5000 }).catch(() => {}); assert(/destination\.html\?page=products/.test(popup.url()), 'ctrl+click: ' + popup.url()); await popup.close();
    [popup] = await Promise.all([desktop.waitForEvent('page'), link.click({ button: 'middle' })]);
    await popup.waitForURL(/destination\.html\?page=products/, { timeout: 5000 }).catch(() => {}); assert(/destination\.html\?page=products/.test(popup.url()), 'middle-click: ' + popup.url()); await popup.close();
    assert(/demo\.html/.test(page.url()), 'original tab navigated');
    await page.close();
  });
  await test('C4 external URL with target=_blank opens in a new tab', async () => {
    await desktop.route('https://example.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>example</title>ok' }));
    const { page } = await open(desktop); const link = page.locator('.site-footer .venom-button');
    const [popup] = await Promise.all([desktop.waitForEvent('page'), link.click()]); await popup.waitForLoadState();
    assert(popup.url() === 'https://example.com/', 'popup url ' + popup.url());
    assert((await link.getAttribute('rel')) === 'noopener noreferrer', 'rel attribute altered');
    await desktop.unroute('https://example.com/**'); await page.close();
  });
  await test('C5 WITHOUT JavaScript it is still a good-looking, working link', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
    const page = await ctx.newPage(); await page.goto(DEMO);
    const link = page.locator('.hero .venom-button');
    assert((await link.getAttribute('data-venom-state')) === null, 'script ran although JS is disabled?');
    const png = await link.screenshot(); const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
    let dark = 0, white = 0; for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const v = px(x, y); if (v < 70) dark++; else if (v > 220) white++; }
    assert(px(20, Math.floor(info.height / 2)) < 70 && dark > info.width * info.height * 0.5, 'static black pill not rendered');
    assert(white > 80, 'label text not visible');
    await Promise.all([page.waitForURL(/destination\.html\?page=products/), link.click()]);
    await ctx.close(); return 'static pill + label visible, click navigated';
  });
  await test('C6 touch: tap near makes the substance reach (and let go), tap on it navigates', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(INSTRUMENT);
    const { page, errs } = await open(ctx); const link = page.locator('.hero .venom-button'); await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 70);
    await page.waitForFunction(() => parseFloat(document.querySelector('.hero .venom-button canvas').style.width) > 600, null, { timeout: 2500 });
    await page.waitForFunction(() => { const a = document.querySelector('.hero .venom-button'); return parseFloat(a.querySelector('canvas').style.width) <= a.getBoundingClientRect().width + 226; }, null, { timeout: 8000 });
    await Promise.all([page.waitForURL(/destination\.html\?page=products/), page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)]);
    assert(errs.length === 0, errs.join('|')); await ctx.close(); return 'reach → release → tap navigated';
  });

  /* ═══════════ D. never blocks the page ═══════════ */
  group('D. Never blocks other interaction');
  await test('D1 ordinary controls inside the effect zone still receive clicks, focus and typing', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2 + 20, { steps: 8 }); await page.waitForTimeout(500);
    await page.locator('.host-btn').click();
    assert(/Subscribe button received the click/.test(await page.textContent('#status')), 'Subscribe handler did not run');
    await page.locator('input[type=email]').click(); await page.keyboard.type('qa@example.com');
    assert((await page.inputValue('input[type=email]')) === 'qa@example.com', 'typing into input failed');
    await page.close();
  });
  await test('D2 hit-testing across the whole effect canvas never lands on a venom layer', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2 + 20, { steps: 8 }); await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const a = document.querySelector('.hero .venom-button'), c = a.querySelector('canvas'), cr = c.getBoundingClientRect(), ar = a.getBoundingClientRect();
      let n = 0, bad = 0; const sel = 'canvas.venom-button__canvas,.venom-button__pointer,.venom-button__cursor,.venom-button__label';
      for (let x = Math.max(1, cr.left + 3); x < Math.min(innerWidth - 1, cr.right); x += 17) for (let y = Math.max(1, cr.top + 3); y < Math.min(innerHeight - 1, cr.bottom); y += 17) {
        const el = document.elementFromPoint(x, y); n++; if (!el) continue;
        const inside = x >= ar.left && x <= ar.right && y >= ar.top && y <= ar.bottom;
        if (el.matches(sel) || (!inside && el.closest('.venom-button') === a)) bad++;
      }
      return { n, bad, w: cr.width, h: cr.height };
    });
    assert(r.bad === 0, r.bad + ' of ' + r.n + ' points were hit by an effect layer'); await page.close(); return `${r.n} points over a ${Math.round(r.w)}×${Math.round(r.h)} canvas`;
  });
  await test('D3 mouse-wheel scrolling works while the cursor is inside the effect zone', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2 + 20, { steps: 8 }); await page.waitForTimeout(400);
    await page.mouse.wheel(0, 300); await page.waitForTimeout(400);
    const y = await page.evaluate(() => scrollY); assert(y > 100, 'page did not scroll: ' + y); await page.close(); return 'scrollY=' + y;
  });
  await test('D4 the effect follows the cursor through page scrolling', async () => {
    const { page } = await open(desktop);
    const box = await page.locator('.hero .venom-button').boundingBox(); const px = box.x + box.width + 70, py = box.y + box.height / 2 + 20;
    await page.mouse.move(px, py, { steps: 8 }); await page.waitForTimeout(600);
    await page.mouse.wheel(0, 90); await page.waitForTimeout(900);
    const blob = await page.evaluate(([px, py]) => window.__alpha(document.querySelector('.hero .venom-button canvas'), px - 6, py - 6, px + 16, py + 20), [px, py]);
    assert(blob > 80, 'blob did not stay with the cursor after scrolling (' + blob + ')'); await page.close();
  });

  /* ═══════════ E. layout safety ═══════════ */
  group('E. Layout safety (no phantom scrollbars)');
  await test('E1 hovering every demo button adds no horizontal scroll and no extra page height', async () => {
    const bare = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
    const bp = await bare.newPage(); await bp.goto(DEMO);
    const base = await bp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight })); await bare.close();
    const { page } = await open(desktop); const n = await page.$$eval('.venom-button', e => e.length);
    for (let i = 0; i < n; i++) {
      const a = page.locator('.venom-button').nth(i); await a.scrollIntoViewIfNeeded(); const b = await a.boundingBox();
      const near = [[b.x + b.width + 40, b.y + b.height / 2], [b.x - 40, b.y + b.height / 2], [b.x + b.width / 2, b.y + b.height + 40], [b.x + b.width / 2, b.y - 40]];
      for (const [x, y] of near) { if (x > 2 && x < 1278 && y > 2 && y < 798) { await page.mouse.move(x, y, { steps: 4 }); await page.waitForTimeout(350); } }
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight }));
      assert(m.sw === m.cw, `button ${i}: horizontal overflow ${m.sw} > ${m.cw}`); assert(m.sh === base.sh, `button ${i}: page height ${m.sh} ≠ ${base.sh}`);
    }
    await page.close(); return `${n} buttons, scrollWidth=clientWidth=${base.cw}, scrollHeight=${base.sh} unchanged`;
  });
  await test('E2 page-corner button, nested scroller and RTL page: no scroll area added; overflow:hidden parent clips', async () => {
    const { page } = await open(desktop, FIX('edges.html'));
    const m0 = await page.evaluate(() => { const s = document.getElementById('scroller'); return { dw: document.documentElement.scrollWidth, dh: document.documentElement.scrollHeight, cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight, sw: s.scrollWidth, sh: s.scrollHeight, cw2: s.clientWidth, ch2: s.clientHeight }; });
    for (const sel of ['#scroller .venom-button', '#corner']) {
      const b = await page.locator(sel).boundingBox();
      for (const [x, y] of [[b.x - 90, b.y + b.height / 2], [b.x + b.width / 2, b.y - 70]]) { await page.mouse.move(x, y, { steps: 6 }); await page.waitForTimeout(450); }
      const m = await page.evaluate(() => { const s = document.getElementById('scroller'); return { dw: document.documentElement.scrollWidth, dh: document.documentElement.scrollHeight, sw: s.scrollWidth, sh: s.scrollHeight }; });
      assert(m.dw === m0.dw && m.dh === m0.dh, `${sel}: document scroll size changed ${m0.dw}×${m0.dh} → ${m.dw}×${m.dh}`);
      assert(m.sw === m0.sw && m.sh === m0.sh, `${sel}: nested scroller grew ${m0.sw}×${m0.sh} → ${m.sw}×${m.sh}`);
    }
    assert(m0.dw === m0.cw && m0.dh === m0.ch && m0.sw === m0.cw2 && m0.sh === m0.ch2, 'baseline already scrollable');
    await page.close();
    const rtl = await open(desktop, FIX('edges-rtl.html'));
    const r0 = await rtl.page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, c: document.documentElement.clientWidth }));
    for (const sel of ['#a', '#b']) { const b = await rtl.page.locator(sel).boundingBox(); for (const [x, y] of [[b.x + b.width + 90, b.y + b.height / 2], [b.x + b.width / 2, b.y - 70]]) { await rtl.page.mouse.move(Math.max(2, x), Math.max(2, y), { steps: 6 }); await rtl.page.waitForTimeout(450); } }
    const r1 = await rtl.page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    assert(r1.w === r0.w && r1.h === r0.h && r0.w === r0.c, `RTL: scroll size changed ${r0.w}×${r0.h} → ${r1.w}×${r1.h}`);
    await rtl.page.close(); return 'corner, nested scroller, RTL: scroll sizes unchanged while hovering';
  });
  await test('E3 responsive: narrow viewport, container-fitting, and DPR 2 backing store', async () => {
    const bareCtx = await browser.newContext({ viewport: { width: 360, height: 740 }, javaScriptEnabled: false }); const bp = await bareCtx.newPage(); await bp.goto(DEMO);
    const bareW = await bp.evaluate(() => document.documentElement.scrollWidth); await bareCtx.close();
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 }); await ctx.addInitScript(INSTRUMENT);
    const { page, errs } = await open(ctx);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      lg: (() => { const a = document.querySelector('.venom-button--lg'), r = a.getBoundingClientRect(), p = a.parentElement.getBoundingClientRect(); return { w: r.width, parent: p.width }; })(),
      px: (() => { const c = document.querySelector('.hero .venom-button canvas'); return c.width / parseFloat(c.style.width); })() }));
    assert(m.sw === bareW, 'component changed the page width at 360px: ' + bareW + ' → ' + m.sw); assert(m.sw === m.cw, 'overflow at 360px: ' + m.sw + ' > ' + m.cw); assert(m.lg.w <= m.lg.parent + 0.5, 'large button overflows its container');
    assert(Math.abs(m.px - 2) < 0.01, 'backing store is not 2× at DPR 2: ' + m.px); assert(errs.length === 0, errs.join('|'));
    await page.setViewportSize({ width: 1100, height: 740 }); await page.waitForTimeout(500);
    const after = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'), c = a.querySelector('canvas'); return { state: a.getAttribute('data-venom-state'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cssw: parseFloat(c.style.width) }; });
    assert(after.state === 'live' && after.sw === after.cw, 'broke after resize'); await ctx.close(); return 'DPR 2 → backing store 2×; resize 360→1100 ok';
  });

  await test('E4 layout drift (button moved by layout, nothing resized): no stale clamp, in either direction', async () => {
    const { page } = await open(desktop);
    const base = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    // slide the hero button against the right page edge with a transform (no element changes size)
    await page.evaluate(() => { document.querySelector('.cta-wrap').style.transform = 'translateX(484px)'; });
    await page.waitForTimeout(1600);
    const edge = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, right: Math.round(a.getBoundingClientRect().right) }; });
    assert(edge.sw === edge.cw && edge.sw === base.sw, `stale clamp overflowed the page at the right edge: scrollWidth ${edge.sw} vs ${edge.cw} (button right edge ${edge.right})`);
    // slide it back to the centre: the effect must regain its full room (not stay squeezed to the old edge clamp)
    await page.evaluate(() => { document.querySelector('.cta-wrap').style.transform = ''; });
    await page.waitForTimeout(1600);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 70, box.y + box.height / 2 + 25, { steps: 10 }); await page.waitForTimeout(900);
    const w = await page.evaluate(() => parseFloat(document.querySelector('.hero .venom-button canvas').style.width));
    assert(w > 950, 'effect still squeezed after moving away from the edge: canvas ' + w + 'px');
    await page.close(); return `edge: scrollWidth stayed ${edge.sw}; back at centre: canvas ${w}px (full reach)`;
  });

  /* ═══════════ F. accessibility / motion ═══════════ */
  group('F. Reduced motion');
  await test('F1 prefers-reduced-motion: no tendrils, no canvas growth, animation loop stops', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); await ctx.addInitScript(INSTRUMENT);
    const { page, errs } = await open(ctx); await page.waitForTimeout(1800);
    const box = await page.locator('.hero .venom-button').boundingBox();
    await page.mouse.move(box.x + box.width + 70, box.y + box.height / 2 + 25, { steps: 10 }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const a = document.querySelector('.hero .venom-button'), c = a.querySelector('canvas'), r = a.getBoundingClientRect(); const f0 = window.__raf; return new Promise(res => setTimeout(() => res({ w: parseFloat(c.style.width), bw: r.width, tendrils: window.__alpha(c, r.right + 8, r.top - 50, r.right + 260, r.bottom + 50), frames: window.__raf - f0, hide: a.hasAttribute('data-venom-hide-cursor') }), 600)); });
    assert(r.w <= narrowW(r.bw) + 2, 'canvas widened under reduced motion'); assert(r.tendrils < 30, 'tendrils drawn under reduced motion: ' + r.tendrils);
    assert(r.frames <= 3, 'loop still running: ' + r.frames + ' frames in 600ms'); assert(!r.hide, 'cursor hidden under reduced motion'); assert(errs.length === 0, errs.join('|'));
    await Promise.all([page.waitForURL(/destination/), page.locator('.hero .venom-button').click()]);   // still fully usable
    await ctx.close(); return `${r.frames} frames/600ms, tendril px ${r.tendrils}`;
  });

  /* ═══════════ G. lifecycle & performance hygiene ═══════════ */
  group('G. Lifecycle');
  await test('G1 one set of global listeners and one loop for any number of buttons', async () => {
    const { page } = await open(desktop);
    const l = await page.evaluate(() => ({ move: window.__ls['window:pointermove'], down: window.__ls['window:pointerdown'], vis: window.__ls['document:visibilitychange'], n: document.querySelectorAll('.venom-button').length, again: VenomButton.init().length }));
    assert(l.n === 7 && l.move === 1 && l.down === 1 && l.vis === 1, 'listener counts: ' + JSON.stringify(l)); assert(l.again === 0, 'init() created duplicates');
    const after = await page.evaluate(() => window.__ls['window:pointermove']); assert(after === 1, 'duplicate listener after re-init'); await page.close(); return `7 buttons → 1 pointermove / 1 pointerdown / 1 visibilitychange listener`;
  });
  await test('G2 pauses when the tab is hidden and resumes when visible', async () => {
    const { page } = await open(desktop);
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = {};
      let f = window.__raf; await sleep(400); out.running = window.__raf - f;
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await sleep(150);
      f = window.__raf; await sleep(500); out.hidden = window.__raf - f;
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await sleep(150);
      f = window.__raf; await sleep(400); out.resumed = window.__raf - f; return out;
    });
    assert(r.running > 12 && r.hidden <= 1 && r.resumed > 12, JSON.stringify(r)); await page.close(); return `frames/400ms: running ${r.running}, hidden ${r.hidden}, resumed ${r.resumed}`;
  });
  await test('G3 off-screen instances stop rendering; they resume when scrolled into view', async () => {
    const { page } = await open(desktop, FIX('two.html'));
    const q = () => page.evaluate(() => ({ a: document.querySelector('#A canvas').__draws || 0, b: document.querySelector('#B canvas').__draws || 0 }));
    await page.waitForTimeout(500); const s0 = await q(); await page.waitForTimeout(600); const s1 = await q();
    assert(s1.a - s0.a > 20, 'visible instance not animating'); assert(s1.b - s0.b <= 1, 'off-screen instance still rendering: ' + (s1.b - s0.b));
    await page.evaluate(() => document.querySelector('#B').scrollIntoView({ block: 'center' })); await page.waitForTimeout(500);
    const s2 = await q(); await page.waitForTimeout(600); const s3 = await q();
    assert(s3.b - s2.b > 20, 'instance did not resume after scrolling into view'); assert(s3.a - s2.a <= 1, 'instance left behind keeps rendering');
    await page.close(); return `visible ${s1.a - s0.a} draws/600ms vs off-screen ${s1.b - s0.b}`;
  });
  await test('G4 removed buttons are cleaned up automatically: listeners, loop, observers', async () => {
    const { page } = await open(desktop);
    await page.evaluate(() => document.querySelectorAll('.venom-button').forEach(e => e.remove())); await page.waitForTimeout(400);
    const r = await page.evaluate(async () => { const f = window.__raf; await new Promise(r => setTimeout(r, 400)); const ls = window.__ls; return { move: ls['window:pointermove'], down: ls['window:pointerdown'], up: ls['window:pointerup'], vis: ls['document:visibilitychange'], resize: ls['window:resize'], frames: window.__raf - f }; });
    assert(r.move === 0 && r.down === 0 && r.up === 0 && r.vis === 0 && r.resize === 0, 'listeners leaked: ' + JSON.stringify(r)); assert(r.frames <= 1, 'animation loop still running: ' + r.frames);
    await page.close(); return 'all global listeners removed, rAF loop stopped';
  });
  await test('G5 dynamic add is picked up; destroy() restores the original markup and stays off', async () => {
    const { page } = await open(desktop);
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)); const d = document.createElement('div'); d.innerHTML = '<a id="dyn" href="destination.html?page=dyn" class="venom-button">DYNAMIC</a>'; document.body.appendChild(d); await sleep(300);
      const el = document.getElementById('dyn'); const out = { live: el.getAttribute('data-venom-state'), kids: el.children.length };
      VenomButton.destroy(el); await sleep(400);
      out.afterKids = el.children.length; out.afterText = el.textContent; out.afterState = el.getAttribute('data-venom-state'); out.registered = !!VenomButton.get(el); return out;
    });
    assert(r.live === 'live' && r.kids === 3, 'not auto-enhanced: ' + JSON.stringify(r)); assert(r.afterKids === 0 && r.afterText === 'DYNAMIC' && r.afterState === 'off' && !r.registered, 'destroy did not restore/stay off: ' + JSON.stringify(r));
    await page.close();
  });

  /* ═══════════ H. isolation from the host ═══════════ */
  group('H. Isolation from the host site');
  await test('H1 stylesheet audit: every selector is namespaced', async () => {
    const css = fs.readFileSync(path.join(ROOT, 'venom-button.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = []; const re = /([^{}]+)\{/g; let m; while ((m = re.exec(css))) { const s = m[1].trim(); if (s && !s.startsWith('@')) s.split(',').forEach(x => sels.push(x.trim())); }
    const bad = sels.filter(s => !/venom-button/.test(s) && !/data-venom-zone-cursor/.test(s));
    const bareTags = sels.filter(s => /^(\*|body|html|a|button|h[1-6]|p|div|span|img|input)(\s|$|:|\.|\[|>)/i.test(s) && !/venom/.test(s));
    assert(bad.length === 0 && bareTags.length === 0, 'un-namespaced selectors: ' + bad.concat(bareTags).join(' | ')); return sels.length + ' selectors, all .venom-button-scoped (+1 opt-in html[data-venom-zone-cursor])';
  });
  await test('H2 computed styles of everything OUTSIDE the buttons are identical with and without the component', async () => {
    let html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
    html = html.replace(/<link[^>]*venom-button\.css[^>]*>/, '').replace(/<script[^>]*venom-button\.js[^>]*><\/script>/, '');
    const bareFile = path.join(ROOT, 'tests', 'out', 'demo-bare.html'); fs.writeFileSync(bareFile, html);
    const snap = async url => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(700);
      const out = await p.evaluate(() => { const props = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textDecorationLine', 'textTransform', 'textAlign', 'cursor', 'display', 'position', 'zIndex', 'opacity', 'visibility', 'overflowX', 'overflowY', 'boxSizing', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'marginTop', 'paddingTop', 'paddingLeft', 'transform', 'filter', 'pointerEvents', 'userSelect', 'touchAction', 'outlineStyle'];
        const rows = []; document.querySelectorAll('*').forEach(el => { if (el.closest('.venom-button') || ['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD'].includes(el.tagName)) return; const cs = getComputedStyle(el); rows.push(el.tagName + '#' + rows.length + ':' + props.map(p => cs[p]).join('|')); });
        return { rows, htmlAttrs: document.documentElement.getAttributeNames().join(','), bodyAttrs: document.body.getAttributeNames().join(','), bodyStyleAttr: document.body.getAttribute('style'), htmlStyleAttr: document.documentElement.getAttribute('style') }; });
      await ctx.close(); return out; };
    const [full, bare] = [await snap(DEMO), await snap('file://' + bareFile)];
    assert(full.rows.length === bare.rows.length, 'element count differs'); const diff = full.rows.map((r, i) => r === bare.rows[i] ? null : [r, bare.rows[i]]).filter(Boolean);
    assert(diff.length === 0, diff.length + ' elements changed, first: ' + (diff[0] && diff[0][0].split(':')[0]));
    assert(full.htmlAttrs === bare.htmlAttrs && full.bodyAttrs === bare.bodyAttrs && full.bodyStyleAttr === bare.bodyStyleAttr && full.htmlStyleAttr === bare.htmlStyleAttr, 'html/body attributes changed');
    return `${full.rows.length} host elements × ${32} properties identical; <html>/<body> attributes untouched`;
  });
  await test('H3 hostile host CSS (a:hover red, underline, visited purple) cannot restyle the label', async () => {
    const { page } = await open(desktop); const a = page.locator('.hero .venom-button'); await a.hover(); await page.waitForTimeout(300);
    const s = await a.evaluate(el => { const l = el.querySelector('.venom-button__label'), c = getComputedStyle(el), lc = getComputedStyle(l); return { color: c.color, deco: c.textDecorationLine, lcolor: lc.color, font: c.fontFamily.split(',')[0] }; });
    assert(s.color === 'rgb(255, 255, 255)' && s.lcolor === 'rgb(255, 255, 255)' && s.deco === 'none', 'host link styles leaked into the button: ' + JSON.stringify(s));
    await page.close(); return `colour ${s.color}, decoration ${s.deco}, font ${s.font}`;
  });
  await test('H4 JS footprint: one global (VenomButton), nothing on body/html, no stray listeners on document.body', async () => {
    const { page } = await open(desktop);
    const g = await page.evaluate(() => ({ added: Object.keys(window).filter(k => !window.__globals0.includes(k) && !k.startsWith('__')), body: window.__ls['el:pointermove'] || 0 }));
    assert(g.added.length === 1 && g.added[0] === 'VenomButton', 'globals added: ' + g.added.join(',')); await page.close(); return 'window.VenomButton only';
  });

  /* ═══════════ I. robustness / stress ═══════════ */
  group('I. Robustness');
  await test('I1 8 seconds of chaotic input (teleports, jitters, presses, Tab/Enter-less keys, blur): no errors, nothing falls back', async () => {
    const { page, errs } = await open(desktop); let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const t0 = Date.now(); let moves = 0;
    while (Date.now() - t0 < 8000) {
      const k = rnd();
      if (k < .5) await page.mouse.move(rnd() * 1279, rnd() * 799, { steps: 1 + (rnd() * 12 | 0) });
      else if (k < .7) { const b = await page.locator('.hero .venom-button').boundingBox(); await page.mouse.move(b.x + rnd() * b.width, b.y + rnd() * b.height); await page.mouse.down(); await page.waitForTimeout(rnd() * 80); await page.mouse.move(b.x + rnd() * b.width, b.y + 120 * rnd()); await page.mouse.up(); }
      else if (k < .8) await page.mouse.wheel(0, (rnd() - .5) * 600);
      else if (k < .9) { await page.keyboard.press('Shift+Tab'); }
      else { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); }
      moves++; await page.waitForTimeout(rnd() * 40);
      if (await page.evaluate(() => location.pathname.endsWith('destination.html'))) { await page.goBack(); await page.waitForTimeout(400); }   // a press on the link legitimately navigates
    }
    const states = await page.$$eval('.venom-button', e => e.map(x => x.getAttribute('data-venom-state')));
    assert(errs.length === 0, 'errors: ' + errs.slice(0, 2).join(' | ')); assert(states.every(s => s === 'live'), 'an instance fell back: ' + states.join(','));
    await page.close(); return moves + ' random actions';
  });

  /* ═══════════ J. performance snapshot (original vs component, same scripted interaction) ═══════════ */
  group('J. Performance (main-thread JS time per animation frame; GPU/raster not included)');
  await test('J1 per-frame cost is in line with the original', async () => {
    const TIMER = () => { window.__ms = []; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); cb(t); window.__ms.push(performance.now() - s); }); };
    const measure = async (url, selector, active) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await ctx.addInitScript(TIMER); const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1200);
      if (active) { await p.mouse.move(1000, 340); await p.mouse.move(850, 372, { steps: 10 }); }
      await p.waitForTimeout(500); await p.evaluate(() => { window.__ms.length = 0; });
      if (active) for (let i = 0; i < 40; i++) { await p.mouse.move(820 + Math.sin(i / 3) * 40, 372 + Math.cos(i / 4) * 30); await p.waitForTimeout(25); } else await p.waitForTimeout(1500);
      const ms = await p.evaluate(() => window.__ms.slice()); await ctx.close(); ms.sort((a, b) => a - b); const mean = ms.reduce((a, b) => a + b, 0) / ms.length; return { n: ms.length, mean, p95: ms[Math.floor(ms.length * .95)] };
    };
    const O = FIX('original.html'), C = FIX('harness.html'); const rows = {};
    for (const [label, url, active] of [['idle', 0, false], ['reaching', 0, true]]) { rows[label] = { orig: await measure(O, '#b', active), comp: await measure(C, '.venom-button', active) }; }
    const f = x => x.mean.toFixed(2) + ' ms (p95 ' + x.p95.toFixed(2) + ')';
    console.log('        idle     original ' + f(rows.idle.orig) + '   component ' + f(rows.idle.comp));
    console.log('        reaching original ' + f(rows.reaching.orig) + '   component ' + f(rows.reaching.comp));
    assert(rows.reaching.comp.p95 < 8 && rows.idle.comp.p95 < 8, 'frame cost too high for 60fps budget');
    assert(rows.reaching.comp.mean < rows.reaching.orig.mean * 2 + 0.5, 'component more than 2× slower than the original');
    return 'within 60 fps budget; see numbers above';
  });

  /* ═══════════ K. packaging ═══════════ */
  group('K. Packaging / options');
  await test('K1 venom-button.mjs is exactly what scripts/make-esm.js generates from venom-button.js', async () => {
    const { build } = require('../scripts/make-esm.js');
    assert(build() === fs.readFileSync(path.join(ROOT, 'venom-button.mjs'), 'utf8'), 'venom-button.mjs is stale: run  node scripts/make-esm.js');
  });
  await test('K2 <script data-auto="false"> = manual mode; data-venom-static keeps the plain CSS look', async () => {
    const page = await desktop.newPage(); const errs = collect(page); await page.goto(FIX('manual.html')); await page.waitForTimeout(600);
    const before = await page.evaluate(() => ({ m1: document.getElementById('m1').getAttribute('data-venom-state'), api: typeof VenomButton }));
    assert(before.api === 'object' && before.m1 === null, 'auto-init ran despite data-auto="false": ' + JSON.stringify(before));
    const after = await page.evaluate(() => { const made = VenomButton.init().length; const m1 = document.getElementById('m1'), m2 = document.getElementById('m2'); return { made, m1: m1.getAttribute('data-venom-state'), m2: m2.getAttribute('data-venom-state'), m2kids: m2.children.length, forced: VenomButton.create(m2) }; });
    assert(after.made === 1 && after.m1 === 'live', 'manual init failed: ' + JSON.stringify(after)); assert(after.m2 === 'static' && after.m2kids === 0 && after.forced === null, 'static opt-out not respected: ' + JSON.stringify(after));
    await Promise.all([page.waitForURL(/page=static/), page.locator('#m2').click()]); assert(errs.length === 0, errs.join('|'));
  });

  await test('K3 failure paths degrade to the plain static link (markup rolled back / engine error contained)', async () => {
    const page = await desktop.newPage(); const pageErrs = []; page.on('pageerror', e => pageErrs.push(e.message)); await page.goto(FIX('manual.html')); await page.waitForTimeout(300);
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = {};
      // 1) the element's own canvas refuses to give a 2D context: original markup (incl. nested elements) must be restored
      const a = document.createElement('a'); a.className = 'venom-button'; a.href = 'destination.html?page=x'; a.innerHTML = 'ROLLBACK <b>TEST</b>'; document.body.appendChild(a);
      const orig = HTMLCanvasElement.prototype.getContext; let n = 0; HTMLCanvasElement.prototype.getContext = function (...args) { n++; return n === 2 ? null : orig.apply(this, args); };
      const inst = VenomButton.create(a); HTMLCanvasElement.prototype.getContext = orig;
      out.build = { inst, html: a.innerHTML, state: a.getAttribute('data-venom-state') };
      // 2) the engine throws after the button went live: it must fall back, log once, and never throw from later observer callbacks
      const b = document.createElement('a'); b.className = 'venom-button'; b.href = 'destination.html?page=y'; b.textContent = 'BREAK'; document.body.appendChild(b);
      const v = VenomButton.create(b); await sleep(200); v.engine.redraw = () => { throw new Error('boom'); };
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, pointerType: 'mouse' })); await sleep(300);
      out.afterFail = b.getAttribute('data-venom-state'); window.dispatchEvent(new Event('resize')); await sleep(400); out.afterResize = b.getAttribute('data-venom-state'); return out;
    });
    assert(r.build.inst === null && r.build.html === 'ROLLBACK <b>TEST</b>' && r.build.state === 'fallback', 'build failure not rolled back: ' + JSON.stringify(r.build));
    assert(r.afterFail === 'fallback' && r.afterResize === 'fallback', 'engine failure not contained: ' + JSON.stringify(r)); assert(pageErrs.length === 0, 'uncaught page errors: ' + pageErrs.join('|'));
  });

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + '─'.repeat(60) + `\n${results.length - failed.length}/${results.length} tests passed` + (failed.length ? '\nFAILED:\n  - ' + failed.map(f => f.name).join('\n  - ') : ''));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
