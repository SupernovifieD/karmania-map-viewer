/**
 * The embedding page: a page that is not the app, and that puts viewers in itself as the page of an embedder would, using only what
 * `@karmania/viewer` gives. The tests drive it through `window.embed`, which is the package as it is exported (so that a test that cannot
 * reach something an embedder needs shows it).
 */
import '@karmania/ui/tokens.css';
import '@karmania/ui/base.css';
import * as embed from '@karmania/viewer';
import { forceThemeFromAddress } from './theme.js';

forceThemeFromAddress();

declare global {
  interface Window {
    /** What `@karmania/viewer` exports. */
    embed: typeof embed;
  }
}

window.embed = embed;
