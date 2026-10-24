'use client';
/*
 * VenomButton.jsx – React / Next.js wrapper for the VENOM button.
 *
 *   import './venom-button.css';                 // once, e.g. in app/layout.jsx or _app.jsx
 *   import VenomButton from './VenomButton';
 *
 *   <VenomButton href="/products">ENTER HERE</VenomButton>
 *   <VenomButton href="/archive" width={340} height={104} fontSize={14}>VIEW THE ARCHIVE</VenomButton>
 *   <VenomButton as={Link} href="/login">LOG IN</VenomButton>        // next/link: client-side navigation
 *
 * It renders the complete markup itself (link + canvas + label + pointer layer), so React owns every node:
 * server-rendered HTML hydrates without mismatches, and the engine only *adopts* the elements in an effect.
 * The effect is StrictMode-safe (mount → cleanup → mount) and cleans everything up on unmount.
 */
import { forwardRef, useCallback, useEffect, useRef } from 'react';
import venom from './venom-button.mjs';

const px = v => (typeof v === 'number' ? v + 'px' : v);

const VenomButton = forwardRef(function VenomButton(
  {
    href,
    children = 'ENTER HERE',
    className,
    style,
    width,          // number (px) or any CSS length, e.g. "100%"
    height,
    fontSize,
    radius,
    cursor,         // 'over' (default) | 'zone' | 'native'
    reach,          // advanced: max px the effect may extend past the button
    as: Component = 'a',
    ...rest         // aria-label, target, rel, onClick, … go straight to the link
  },
  forwardedRef
) {
  const ref = useRef(null);
  const setRef = useCallback(node => {
    ref.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    venom.create(el, { cursor, reach });
    return () => venom.destroy(el);
  }, [cursor, reach]);

  const vars = {};
  if (width != null) vars['--venom-width'] = px(width);
  if (height != null) vars['--venom-height'] = px(height);
  if (fontSize != null) vars['--venom-font-size'] = px(fontSize);
  if (radius != null) vars['--venom-radius'] = px(radius);

  return (
    <Component
      ref={setRef}
      href={href}
      className={['venom-button', className].filter(Boolean).join(' ')}
      style={{ ...vars, ...style }}
      {...rest}
    >
      <canvas className="venom-button__canvas" aria-hidden="true" />
      <span className="venom-button__label">{children}</span>
      <span className="venom-button__pointer" aria-hidden="true">
        <svg className="venom-button__cursor" width="24" height="28" viewBox="0 0 24 28" aria-hidden="true" focusable="false">
          <path d="M1.5 1.5v20l5.2-4.8 3.6 8.4 3.5-1.5-3.6-8.2H17z" fill="#050506" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M4 7v10" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity=".5" />
        </svg>
      </span>
    </Component>
  );
});

export default VenomButton;
export { VenomButton };
