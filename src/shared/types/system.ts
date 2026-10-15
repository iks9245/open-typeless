/** OS login-item state; never persisted in the settings database. */
export interface LoginItemState {
  supported: boolean;
  enabled: boolean;
  requiresApproval: boolean;
}
