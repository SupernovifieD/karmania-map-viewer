/** Whether something being dragged carries files: the only drags the app has any use for. */
export function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
