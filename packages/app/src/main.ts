/** The app's page: the styles, the theme the address asks for, and the root element. */
import '@karmania/ui/tokens.css';
import '@karmania/ui/base.css';
import { defineApp } from './app.js';
import { forceThemeFromAddress } from './theme.js';

forceThemeFromAddress();
// The modules are evaluated in this task, and the app is made and drawn in the next: two tasks of the first load and not one (step 24.R2).
setTimeout(defineApp, 0);
