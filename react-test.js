#!/usr/bin/env node
/*
 * React / Next-style integration test: SSR → hydrate (StrictMode) in real Chromium.
 *   needs: react, react-dom, esbuild, playwright   (NODE_PATH or local node_modules)
 *   node tests/react-test.js
 */
const esbuild = require('esbuild'); const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const NODE_PATHS = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const common = { bundle: true, jsx: 'automatic', nodePaths: NODE_PATHS, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error', loader: { '.mjs': 'js' } };
let pass = 0, fail = 0; const ok = (n, c, m) => { if (c) { pass++; console.log('  ✓', n + (m ? '  — ' + m : '')); } else { fail++; console.log('  ✗', n, m ? '\n      ' + m : ''); } };

(async () => {
  // 1) server render: importing the wrapper in plain Node (no window/document) must not throw
  await esbuild.build({ ...common, entryPoints: [path.join(__dirname, 'react/ssr-entry.jsx')], platform: 'node', format: 'cjs', outfile: path.join(OUT, 'ssr.cjs') });
  const markup = require(path.join(OUT, 'ssr.cjs')).html();
  ok('R1 server render works without window/document', markup.includes('venom-button'), markup.length + ' bytes of HTML');
  ok('R2 SSR markup is the complete static link (real href, label, canvas, no JS state)',
    markup.includes('class="venom-button hero-cta"') && markup.includes('href="../fixtures/destination.html?page=react"') && markup.includes('--venom-width:280px') && markup.includes('aria-label="Enter via React"') && markup.includes('ENTER HERE') && markup.includes('venom-button__canvas') && !markup.includes('data-venom-state'));
  await esbuild.build({ ...common, entryPoints: [path.join(__dirname, 'react/client-entry.jsx')], platform: 'browser', format: 'iife', outfile: path.join(OUT, 'client.js') });
  fs.writeFileSync(path.join(OUT, 'react.html'), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>react</title><link rel="stylesheet" href="../../venom-button.css"><style>body{margin:0;background:#f4f2ed;font:16px sans-serif}main{display:flex;flex-direction:column;align-items:center;gap:40px;padding:90px 0}</style></head><body><div id="root">${markup}</div><script src="client.js"></script></body></html>`);

  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  // count only listeners registered by the component's engine (Playwright's own injected script also listens on window).
  // In the bundle the engine's functions keep their names, so its frames are recognisable in the stack.
  await ctx.addInitScript(() => { window.__ls = {}; const a = EventTarget.prototype.addEventListener, r = EventTarget.prototype.removeEventListener;
    const mine = () => /setupGlobals|teardownGlobals/.test(new Error().stack || ''); const k = (t, ty) => (t === window ? 'window:' : 'x:') + ty;
    EventTarget.prototype.addEventListener = function (ty, f, o) { if (this === window && mine()) window.__ls[k(this, ty)] = (window.__ls[k(this, ty)] || 0) + 1; return a.call(this, ty, f, o); };
    EventTarget.prototype.removeEventListener = function (ty, f, o) { if (this === window && mine()) window.__ls[k(this, ty)] = (window.__ls[k(this, ty)] || 0) - 1; return r.call(this, ty, f, o); }; });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.join(OUT, 'react.html'));
  await page.waitForFunction(() => document.querySelectorAll('.venom-button[data-venom-state="live"]').length === 2, null, { timeout: 6000 }).catch(() => {});
  const live = await page.$$eval('.venom-button', e => e.map(x => x.getAttribute('data-venom-state')));
  ok('R3 hydrates cleanly under StrictMode: no hydration/console errors, nothing recoverable', errs.length === 0 && (await page.evaluate(() => window.__recoverable.length)) === 0, errs.concat(await page.evaluate(() => window.__recoverable)).join(' | '));
  ok('R4 both buttons (<a> and as={Link-like}) become live', live.length === 2 && live.every(s => s === 'live'), live.join(','));
  const ls = await page.evaluate(() => window.__ls);
  ok('R5 StrictMode double-mount leaks nothing: exactly one pointermove / pointerdown listener', ls['window:pointermove'] === 1 && ls['window:pointerdown'] === 1, JSON.stringify({ move: ls['window:pointermove'], down: ls['window:pointerdown'] }));
  const box = await page.locator('.hero-cta').boundingBox();
  await page.mouse.move(box.x + box.width + 330, box.y + box.height / 2); await page.mouse.move(box.x + box.width + 70, box.y + box.height / 2 + 25, { steps: 12 }); await page.waitForTimeout(800);
  const wide = await page.evaluate(() => parseFloat(document.querySelector('.hero-cta canvas').style.width));
  ok('R6 the liquid reacts to the pointer inside React-owned DOM', wide > 800, 'canvas ' + wide + 'px');
  await page.evaluate(() => window.__ctl.setCls('hero-cta changed again')); await page.waitForTimeout(300);
  const st = await page.evaluate(() => { const a = document.querySelector('.venom-button.changed'); return a && { state: a.getAttribute('data-venom-state'), cls: a.className, w: parseFloat(a.querySelector('canvas').style.width) }; });
  ok('R7 a React re-render that changes className does not break it (state lives in a data attribute)', st && st.state === 'live' && st.cls.includes('venom-button') && st.w > 0, JSON.stringify(st));
  await Promise.all([page.waitForURL(/destination\.html\?page=react/, { timeout: 5000 }), page.locator('.venom-button.changed').click()]);
  ok('R8 click navigates to the href', /page=react/.test(page.url()), page.url().split('/').slice(-2).join('/'));

  await page.goto('file://' + path.join(OUT, 'react.html')); await page.waitForFunction(() => document.querySelectorAll('.venom-button[data-venom-state="live"]').length === 2);
  await page.evaluate(() => window.__ctl.setShow(false)); await page.waitForTimeout(300);
  let l2 = await page.evaluate(() => ({ n: document.querySelectorAll('.venom-button').length, move: window.__ls['window:pointermove'] }));
  ok('R9 unmounting one of two buttons keeps the shared engine for the other', l2.n === 1 && l2.move === 1, JSON.stringify(l2));
  await page.evaluate(() => window.__ctl.setShow(true)); await page.waitForFunction(() => document.querySelectorAll('.venom-button[data-venom-state="live"]').length === 2, null, { timeout: 4000 }).catch(() => {});
  const l3 = await page.evaluate(() => ({ n: document.querySelectorAll('.venom-button[data-venom-state="live"]').length, move: window.__ls['window:pointermove'] }));
  ok('R10 re-mounting works and still only one global listener set', l3.n === 2 && l3.move === 1, JSON.stringify(l3));
  ok('R11 no errors during the whole session', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} React checks passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
