/** Key width choice: 'auto' follows the screen, 'fit' shows all 88 keys, or a fixed width in px. */
export type KeySizeSetting = 'auto' | 'fit' | number

export const KEY_SIZE = { min: 14, max: 48, step: 4 }

/** CSS for the chosen key width, applied to the keyboard area (the piano reads --white-key). */
export function keySizeStyle(setting: KeySizeSetting): Record<string, string> {
  if (setting === 'auto') return {}
  return { '--white-key': setting === 'fit' ? 'calc((100vw - 16px) / 52)' : `${setting}px` }
}
