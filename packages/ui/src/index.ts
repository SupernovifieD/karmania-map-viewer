/** Public name of this package. */
export const PACKAGE_NAME = '@karmania/ui';

export { sharedStyles } from './shared-styles.js';
export { KIcon } from './components/icon.js';
export type { IconSize } from './components/icon.js';
export { ICON_NAMES, isIconName } from './components/icons.js';
export type { IconName } from './components/icons.js';
export { defineOnce } from './define.js';
export { KButton, kButton } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button.js';
export { KTabs, TAB_CHANGE } from './components/tabs.js';
export type { TabChange, TabDefinition } from './components/tabs.js';
export { KTooltip } from './components/tooltip.js';
export { placeTooltip } from './components/tooltip-position.js';
export type { Box, Placement, Position } from './components/tooltip-position.js';
export { KEmptyState } from './components/empty-state.js';
export { DIALOG_CLOSE, KDialog } from './components/dialog.js';
export { KSteps } from './components/steps.js';
export type { StepDefinition } from './components/steps.js';
export { KInput, INPUT_CHANGE } from './components/input.js';
export type { InputChange, InputMode } from './components/input.js';
export { KSelect, SELECT_CHANGE } from './components/select.js';
export type { SelectChange, SelectOption } from './components/select.js';
