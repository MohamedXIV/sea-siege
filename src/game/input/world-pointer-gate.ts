/** World gestures are valid only while the match HUD is shown and canvas owns the hit. */
export function canHandleWorldPointer(
  hudVisible: boolean, eventOnCanvas: boolean, hitIsCanvas: boolean,
): boolean {
  return hudVisible && eventOnCanvas && hitIsCanvas;
}
