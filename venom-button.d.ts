// Type declarations for venom-button.js / venom-button.mjs
export type VenomCursorMode = 'over' | 'zone' | 'native';

export interface VenomOptions {
  /** 'over' (default): system cursor replaced only while over the button · 'zone': original behaviour · 'native': never touched */
  cursor?: VenomCursorMode;
  /** Advanced: maximum distance in px the effect may extend past the button (60–640, default 380). */
  reach?: number;
  /** Skip the animation and keep the static CSS look. */
  static?: boolean;
}

export interface VenomInstance {
  readonly el: HTMLElement;
  /** Re-measure the button (call after changing its size/position by means the library cannot observe). */
  refresh(): void;
  destroy(final?: boolean): void;
}

export interface VenomButtonApi {
  readonly version: string;
  /** false on the server and in browsers without Canvas 2D */
  readonly supported: boolean;
  defaults: { cursor: VenomCursorMode; reach: number };
  /** Enhance a single element. Idempotent. Returns null when the animation is skipped. */
  create(el: Element | null, options?: VenomOptions): VenomInstance | null;
  /** Enhance every `.venom-button` inside `scope` (default: document). */
  init(scope?: ParentNode | Element, options?: VenomOptions): VenomInstance[];
  /** Remove the effect from an element; it stays a normal link. Frees listeners, loop and canvas memory. */
  destroy(target: Element | VenomInstance | null): void;
  get(el: Element): VenomInstance | null;
  /** Re-measure every instance. */
  refresh(): void;
  /** Auto-enhance current and future `.venom-button` elements (default for the <script> build). */
  auto(on?: boolean): void;
}

declare const venom: VenomButtonApi;
export default venom;
export const VenomButton: VenomButtonApi;
