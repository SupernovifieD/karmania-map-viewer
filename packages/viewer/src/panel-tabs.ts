import type { TabDefinition } from '@karmania/ui';

/** The tabs of the side panel, in order. */
export const PANEL_TABS = [
  { id: 'legend', label: 'Legend' },
  { id: 'data', label: 'Data' },
] as const satisfies readonly TabDefinition[];

/** The id of one of the tabs. */
export type PanelTab = (typeof PANEL_TABS)[number]['id'];

/** Whether some text is the id of a tab of the panel. */
export function isPanelTab(id: unknown): id is PanelTab {
  return PANEL_TABS.some((tab) => tab.id === id);
}
