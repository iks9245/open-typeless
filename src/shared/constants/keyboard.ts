/** Supported physical push-to-talk keys (uiohook keycodes, safe to import in renderers). */
export const TRIGGER_KEYS = [
  { id: 'right-option', label: '右 Option', keycode: 3640 },
  { id: 'right-command', label: '右 Command', keycode: 3676 },
  { id: 'right-control', label: '右 Control', keycode: 3613 },
  { id: 'left-option', label: '左 Option', keycode: 56 },
  { id: 'f13', label: 'F13', keycode: 91 },
  { id: 'f14', label: 'F14', keycode: 92 },
  { id: 'f15', label: 'F15', keycode: 93 },
] as const;

export type TriggerKeyId = typeof TRIGGER_KEYS[number]['id'];

export function triggerKeyLabel(id?: string | null): string {
  return (TRIGGER_KEYS.find(key => key.id === id) ?? TRIGGER_KEYS[0]).label;
}
