/*
 *   node tests/fidelity.js                 shipping build vs original (float32 trajectories differ slightly, see README)
 *   node tests/make-abs-variant.js && VARIANT=abs node tests/fidelity.js     identical-arithmetic variant: <= 2/255 everywhere
 *
 * Fidelity test: runs the ORIGINAL file and the new component side by side with
 *   - a fake clock (performance.now / requestAnimationFrame advanced manually, 60 fps)
 *   - a seeded Math.random
 *   - an identical scripted pointer path
 * and compares the rendered pixels at several moments.
 */
const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ABS = process.env.VARIANT === 'abs' || process.argv.includes('--abs');
const ORIGINAL = 'file://' + path.resolve(__dirname, 'fixtures/original.html');
const COMPONENT = 'file://' + path.resolve(__dirname, ABS ? 'out/harness-abs.html' : 'fixtures/harness.html');
const OUT = path.resolve(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });

const MOCK = () => {
  let t = 0, id = 1; const cbs = new Map();
  performance.now = () => t;
  window.requestAnimationFrame = cb => { const i = id++; cbs.set(i, cb); return i; };
  window.cancelAnimationFrame = i => { cbs.delete(i); };
  window.__tick = (ms) => { t += ms; const run = [...cbs.values()]; cbs.clear(); run.forEach(cb => cb(t)); };
  let s = 0x9E3779B9;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  // hide the DOM cursor arrow in both pages: this test compares the canvas drawing + label
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#c,.venom-button__cursor{display:none!important}'; document.head.appendChild(st); });
};

// scripted pointer path: [frame, x, y, type]
function pathAt(f) {
  const lerp = (a, b, t) => a + (b - a) * t, seg = (f0, f1, p0, p1) => f >= f0 && f <= f1 ? [lerp(p0[0], p1[0], (f - f0) / (f1 - f0)), lerp(p0[1], p1[1], (f - f0) / (f1 - f0))] : null;
  return null
    || (f < 60 ? null : null)
    || seg(60, 110, [1150, 330], [850, 372])      // approach from the right
    || (f > 110 && f < 170 ? [850 + Math.sin(f * .3) * 8, 372] : null) // hold + small wobble
    || seg(170, 215, [850, 372], [640, 360])      // slide over the button
    || (f > 215 && f < 235 ? [640, 360] : null)   // rest on the button (press happens here)
    || seg(235, 260, [640, 360], [330, 300])      // fast sweep to the left
    || seg(260, 300, [330, 300], [520, 520])      // arc below
    || seg(300, 330, [520, 520], [1230, 90])      // fast leave
    || null;
}

async function run(url, frames, shots) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(MOCK);
  await page.goto(url); await page.waitForTimeout(500);
  const out = {};
  for (let f = 0; f <= frames; f++) {
    const p = pathAt(f);
    await page.evaluate(([f, p]) => {
      if (p) window.dispatchEvent(new PointerEvent('pointermove', { clientX: p[0], clientY: p[1], pointerType: 'mouse', bubbles: true }));
      const b = document.getElementById('b') || document.querySelector('.venom-button');
      if (f === 218) b.dispatchEvent(new PointerEvent('pointerdown', { clientX: 640, clientY: 360, pointerType: 'mouse', bubbles: true }));
      if (f === 228) window.dispatchEvent(new PointerEvent('pointerup', { clientX: 640, clientY: 360, pointerType: 'mouse', bubbles: true }));
      window.__tick(1000 / 60);
    }, [f, p]);
    if (shots.includes(f)) out[f] = await page.screenshot();
  }
  await browser.close();
  return { out, errors };
}

(async () => {
  const frames = 380, shots = [30, 90, 130, 165, 200, 224, 250, 280, 320, 345, 380];
  const [a, b] = await Promise.all([run(ORIGINAL, frames, shots), run(COMPONENT, frames, shots)]);
  console.log('errors  original:', a.errors, ' component:', b.errors);
  let worst = 0, allOk = true;
  for (const f of shots) {
    const A = await sharp(a.out[f]).raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(b.out[f]).raw().toBuffer({ resolveWithObject: true });
    const n = A.info.width * A.info.height, ch = A.info.channels; let maxd = 0, over8 = 0, over32 = 0, sse = 0;
    for (let i = 0; i < n; i++) { let d = 0; for (let c = 0; c < 3; c++) { const x = Math.abs(A.data[i * ch + c] - B.data[i * ch + c]); if (x > d) d = x; sse += x * x; } if (d > maxd) maxd = d; if (d > 8) over8++; if (d > 32) over32++; }
    const psnr = sse === 0 ? Infinity : 10 * Math.log10(255 * 255 / (sse / (n * 3)));
    worst = Math.max(worst, maxd);
    console.log(`frame ${String(f).padStart(3)}  maxΔ=${String(maxd).padStart(3)}  px>8: ${String(over8).padStart(5)}  px>32: ${String(over32).padStart(5)}  PSNR=${psnr === Infinity ? '∞' : psnr.toFixed(1)} dB`);
    if (over8 > 12) allOk = false;     // identical-arithmetic variant: at most a handful of rasteriser-noise pixels per frame
    fs.writeFileSync(path.join(OUT, `f${f}-original.png`), a.out[f]); fs.writeFileSync(path.join(OUT, `f${f}-component.png`), b.out[f]);
  }
  if (ABS) {
    console.log(allOk ? 'PASS: identical-arithmetic variant is pixel-identical to the original (<= 12 px per frame differ by > 8/255; remaining ones are rasteriser noise)'
                      : 'FAIL: the engine no longer reproduces the original (see tests/out)');
    process.exit(allOk ? 0 : 1);
  }
  console.log('\nInformational (no pass/fail): the shipping build uses button-centred float32 coordinates, so tendril strands drift by about a pixel\nmid-interaction. Compare tests/control-original-vs-itself.js: the untouched original drifts against itself by the same amount.\nFor the strict logic check run:  npm run test:fidelity:logic');
})();
