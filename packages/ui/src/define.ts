/**
 * Registers a custom element, once. Where there is no page (in a Node test, say) there is
 * nothing to register it with, and a second call for the same name does nothing.
 */
export function defineOnce(name: string, element: CustomElementConstructor): void {
  if ('customElements' in globalThis && customElements.get(name) === undefined) {
    customElements.define(name, element);
  }
}
