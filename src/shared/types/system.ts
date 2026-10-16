/** OS login-item state; never persisted in the settings database. */
export interface LoginItemState {
  supported: boolean;
  enabled: boolean;
  requiresApproval: boolean;
}

export interface SystemInfo { totalMemoryGb: number }

export interface PermissionsStatus {
  microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  accessibility: boolean;
}
export type OnboardingPermission = 'microphone' | 'accessibility';
