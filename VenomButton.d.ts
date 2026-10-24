import type { AnchorHTMLAttributes, ElementType, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';
import type { VenomCursorMode } from './venom-button';

export interface VenomButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Destination URL – internal route or external URL. */
  href: string;
  /** Button label (default "ENTER HERE"). */
  children?: ReactNode;
  className?: string;
  /** px number or any CSS length. */
  width?: number | string;
  height?: number | string;
  fontSize?: number | string;
  radius?: number | string;
  cursor?: VenomCursorMode;
  reach?: number;
  /** Render as another link component, e.g. next/link. Must forward `ref`. */
  as?: ElementType;
}

declare const VenomButton: ForwardRefExoticComponent<VenomButtonProps & RefAttributes<HTMLAnchorElement>>;
export default VenomButton;
export { VenomButton };
