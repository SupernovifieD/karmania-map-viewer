import { unsafeCSS } from 'lit';
import shared from './shared.css?inline';

/**
 * The style sheet every component adopts first: box sizing, the focus ring and native
 * controls that follow the page's font. It is `shared.css`, the same text the page gets.
 */
export const sharedStyles = unsafeCSS(shared);
