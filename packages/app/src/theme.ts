/**
 * Forces a theme when the address says `?theme=light` or `?theme=dark`, which is how the tests
 * and screenshots get a theme whatever the system prefers. Any other value, or none, leaves the
 * system preference in charge.
 */
export function forceThemeFromAddress(): void {
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset['theme'] = theme;
  }
}
