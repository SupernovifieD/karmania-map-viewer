/**
 * The entry of the library build of `@karmania/viewer` (brief 23.2). It is `index.ts`, and the style sheet that a page which embeds the viewer links
 * once: the design tokens (colours, spacing, type, in light and in dark) and Inter. The app does not use this file: it has its own page styles.
 */
import '@karmania/ui/tokens.css';
import '@karmania/ui/fonts.css';

export * from './index.js';
