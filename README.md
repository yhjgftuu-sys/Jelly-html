# VENOM Button

A liquid "symbiote" navigation button. It is a **real `<a href>`**; the animation is a transparent Canvas 2D layer inside it.
No dependencies, no build step, no WebGPU.

```html
<link rel="stylesheet" href="venom-button.css">

<a href="/products" class="venom-button">ENTER HERE</a>

<script src="venom-button.js" defer></script>
```

That is the whole integration. The script finds every `.venom-button`, and keeps finding new ones added later.
Without the script (or if it fails) the same markup is still a working link, drawn as a static black pill.

| File | What it is |
|---|---|
| `venom-button.css` | Namespaced styles + the no-JS look |
| `venom-button.js` | Animation engine + auto-init (classic `<script>` / CommonJS) |
| `venom-button.mjs` | ES-module build for Vite / Next.js / Rollup. **Generated**: `node scripts/make-esm.js` after editing the `.js` |
| `VenomButton.jsx` (+ `.d.ts`) | React / Next.js wrapper |
| `demo.html`, `destination.html` | Demo page (hostile host CSS on purpose) and a real page for its links to land on |
| `tests/` | Playwright suites and the fidelity checks against the original animation |

---

## Recipes

**Change the destination or the text**. It's an ordinary link: edit `href` and the text. Internal routes and external URLs both work.

```html
<a href="/login" class="venom-button" aria-label="Enter your account">ENTER HERE</a>
<a href="https://example.com" class="venom-button" target="_blank" rel="noopener noreferrer">VISIT SITE</a>
```

**Change the size.** Presets, or CSS variables on the element, a parent, or your own class:

```html
<a href="/a" class="venom-button venom-button--sm">SMALL</a>      <!-- 200 × 64 -->
<a href="/b" class="venom-button venom-button--lg">LARGE</a>      <!-- 340 × 104 -->
<a href="/c" class="venom-button venom-button--block">FULL WIDTH</a>
<a href="/d" class="venom-button" style="--venom-width:300px; --venom-height:96px; --venom-font-size:14px">CUSTOM</a>
```
```css
.hero .venom-button { --venom-width: 320px; --venom-height: 96px; }
```
The button never exceeds its container (`max-width:100%`), so it shrinks on narrow screens.

**Several buttons on one page.** Just repeat the markup. Each has its own physics; they share one animation loop and one set of event listeners.

**Hero / navigation.** Put it anywhere a link can go. It is `inline-flex`, so it sits in text flow, flex rows and grids like any inline-block. In a nav bar use `venom-button--sm`. In a sticky header it overlays the content below it with normal stacking, because the canvas lives *inside* the link.

**Use your site's font:** `--venom-font-family: inherit;`

---

## Reference

**CSS variables** (all optional)

| Variable | Default | |
|---|---|---|
| `--venom-width` / `--venom-height` | `264px` / `84px` | box size |
| `--venom-radius` | `36px` | no-JS look, hit area, focus ring |
| `--venom-font-size` / `--venom-font-weight` | `12.5px` / `600` | |
| `--venom-letter-spacing` | `.44em` | |
| `--venom-font-family` | Helvetica stack | `inherit` for your font |
| `--venom-color` | `#fff` | label colour |
| `--venom-focus-ring` / `--venom-focus-offset` | `#000` / `14px` | keyboard focus ring; use `#fff` on dark backgrounds |

**Attributes**

| Attribute | |
|---|---|
| `data-venom-cursor="over"` | **default.** The system cursor is swapped for the liquid-swallowed arrow only while it is over the button. Everywhere else it is untouched. |
| `data-venom-cursor="zone"` | The original demo's behaviour: cursor hidden whenever the substance holds it, page-wide. Opt-in, cleaned up on leave/destroy. |
| `data-venom-cursor="native"` | Never touch the cursor. |
| `data-venom-reach="380"` | Advanced: max px the effect may extend past the button (60–640). |
| `data-venom-static` | Don't animate this one. |
| `data-venom-state` | *Read-only.* `live` · `fallback` · `static` · `off`. |
| `<script … data-auto="false">` | Manual mode: nothing is enhanced until you call `VenomButton.init()`. |

**JavaScript API** (`window.VenomButton`, or `import venom from './venom-button.mjs'`)

```js
VenomButton.init(root?, opts?)    // enhance every .venom-button inside root (default: document); returns new instances
VenomButton.create(el, opts?)     // enhance one element (idempotent); opts: { cursor, reach, static }
VenomButton.destroy(el)           // remove the effect; the element stays a normal static link
VenomButton.get(el)               // instance or null
VenomButton.refresh()             // re-measure all (normally automatic)
VenomButton.auto(false)           // stop auto-enhancing new elements
VenomButton.defaults              // { cursor: 'over', reach: 380 }
```
Removing a button from the DOM cleans it up automatically; when the last one is gone, every global listener and the animation loop are released.

---

## React / Next.js

Copy `venom-button.css`, `venom-button.mjs`, `VenomButton.jsx` (and the two `.d.ts` files for TypeScript) into your project.

```jsx
// app/layout.jsx (or pages/_app.jsx): once
import './venom-button.css';
```
```jsx
// anywhere, including Server Components (the wrapper is marked 'use client')
import VenomButton from '@/components/VenomButton';
import Link from 'next/link';

<VenomButton href="/products">ENTER HERE</VenomButton>
<VenomButton href="/archive" width={340} height={104} fontSize={14}>VIEW THE ARCHIVE</VenomButton>
<VenomButton as={Link} href="/login">LOG IN</VenomButton>        {/* client-side navigation via next/link */}
<VenomButton href="https://example.com" target="_blank" rel="noopener noreferrer">VISIT</VenomButton>
```

Props: `href`, `children`, `className`, `style`, `width`, `height`, `fontSize`, `radius` (number = px, or any CSS length), `cursor`, `reach`, `as`, plus anything an `<a>` accepts (`aria-label`, `target`, `rel`, `onClick`…).

The wrapper renders the full markup itself, so React owns every node and server HTML hydrates without mismatches. The engine only adopts those nodes in an effect (StrictMode-safe) and the state lives in a `data-` attribute, so a re-render that changes `className` can't break it. Importing the module on the server is safe (it's inert without `window`).

---

## How it stays out of your way

* **Navigation is the browser's.** No `preventDefault`, no `href="#"`, no click handler needed. Ctrl/middle-click, context menu, keyboard Enter, `target="_blank"` all behave natively.
* **Nothing intercepts input.** The canvas, label and cursor layers are `pointer-events: none` (checked by hit-testing ~2,500 points across the canvas). Wheel/touch scrolling is never blocked; `touch-action: manipulation` only removes the double-tap delay.
* **CSS isolation.** Every selector is `.venom-button…`-scoped; nothing targets `body`, generic `a`/`button`, fonts or colours. Hostile host rules such as `a:hover{color:red}` can't recolour the label. The one exception is `html[data-venom-zone-cursor]`, inert unless you opt into `zone` mode.
* **JS isolation.** One global (`VenomButton`); no listeners on `body`; one `pointermove`/`pointerdown` listener for the whole page regardless of button count.
* **No scrollbars from the effect.** The canvas extends past the button, so it is clamped to the room the page/scroll container actually has and re-measured on resize, document size change, font load, scrolling into view, and when layout moves the button.
* **Cheap.** One shared `requestAnimationFrame` loop. Off-screen buttons and hidden tabs render nothing. The idle canvas is small (button + 112px) and grows to full reach only when the pointer is within ~400px. State is preallocated typed arrays.
* **Accessibility.** Real link semantics, `:focus-visible` ring (2px, offset 14px), Enter shows the press response. `prefers-reduced-motion`: static glossy body, no tendrils/droplets/hover tracking, loop stops. Forced-colors and print rules are included (checked with Chromium's media emulation: label stays white; print shows the static pill).

## Things to know

* The substance is black: it is designed for light and mid-tone backgrounds. On dark backgrounds set `--venom-focus-ring: #fff`; the body will have little contrast.
* An ancestor with `overflow: hidden/clip` clips the tendrils at its edge (normal CSS). An ancestor that *scrolls* gets the clamp described above.
* Touch: the substance reaches for a finger within ~340px and lets go ~1.3s after it lifts or when the browser turns the gesture into a scroll. A tap on the button navigates immediately.
* In the default cursor mode the native cursor remains visible while the substance engulfs it outside the button (the original replaced it with a drawn arrow everywhere). Use `zone` mode to get that back.
* After editing `venom-button.js`, run `node scripts/make-esm.js` (a test fails if `venom-button.mjs` is stale).

---

## What was verified, and how

All of it in **Chromium 141 (Playwright 1.56), headless, software rendering**, with real mouse/keyboard/touch input. Run it yourself:

```bash
npm install            # playwright, sharp, esbuild, react, react-dom (dev only)
npx playwright install chromium
npm test                     # 37 functional tests
npm run test:react           # 11 React / SSR / hydration checks
npm run test:fidelity        # shipping build vs the original file: pixel report (informational)
npm run test:fidelity:logic  # strict: identical-arithmetic variant: pixels, full state dump, canvas command stream
```

| Claim | Evidence |
|---|---|
| Animation identical to the original | The 14 physics/drawing functions are character-identical to the original (whitespace/semicolons aside). With the same clock, RNG and pointer path, **all 21 state fields (body ring, tendrils, droplets, blob, 14 scalars) are bit-identical for 286 frames** (`state-equivalence.js`) and the **Canvas command stream is identical** (548 commands, `command-stream.js`). Pixels: ≤ 2/255 at 9 of 11 checked frames. |
| …and where it isn't pixel-exact | (a) 9 antialiasing pixels at one frame differ by up to 36/255, and the difference disappears when the canvas size changes, so it is a rasteriser effect. (b) The original draws a nearly-faded speck at the cursor even 450px away; the component's canvas ends at 380px, so that speck is clipped. (c) The shipping build uses button-centred coordinates (so one engine works anywhere on a page), and the engine's `Float32` state is sensitive to coordinate range, so tendril trajectories drift by about a pixel mid-interaction (40–47 dB PSNR vs the original). **The untouched original shows the same drift against itself** when placed at a different page position (34–38 dB, `control-original-vs-itself.js`). |
| Real navigation | Mouse click, keyboard Enter, Ctrl+click and middle-click (new tab), external `target=_blank`, touch tap; also with JavaScript disabled. |
| Doesn't block anything | Clicking/typing in ordinary controls inside the effect zone, wheel scrolling, scrolling while engaged, hit-test sweep. |
| Layout-safe | Zero scroll-size change while hovering all 7 demo buttons, a page-corner button, a nested scroller, an RTL page; narrow viewport; DPR 2; resize; buttons moved by layout. (Two bugs found and fixed by these tests: stale edge clamp after resize, and after layout drift.) |
| Lifecycle | One listener set for 7 buttons; pauses on hidden tab and off-screen; removal frees all listeners and stops the loop; dynamic add; `destroy()` restores markup and doesn't get revived. |
| Isolation | 45 host elements × 32 computed properties identical with and without the component; `<html>`/`<body>` untouched; selector audit. |
| Performance | ≈60 fps (display rate) on the demo page, same as the original; main-thread JS ≈ 0.3–0.45 ms per frame, p95 ≤ 1.5 ms (original ≈ 0.3–0.4 ms). |

**Not verified**: Firefox and Safari (only Chromium is available in my test environment); real phones and real GPUs; actual Next.js (React 19 SSR + hydration + StrictMode **was** verified, with a `next/link`-style stand-in for `as={Link}`); `VenomButton.d.ts` against the real `@types/react` (checked against a minimal stand-in only; `venom-button.d.ts` was checked strictly). The timing numbers are JS main-thread cost only and don't include GPU/raster time.
