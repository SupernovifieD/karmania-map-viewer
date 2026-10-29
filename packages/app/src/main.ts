/** The app's page: the styles, the theme the address asks for, and the root element. */
import '@karmania/ui/tokens.css';
import '@karmania/ui/base.css';
import './app.js';
import { forceThemeFromAddress } from './theme.js';

forceThemeFromAddress();
