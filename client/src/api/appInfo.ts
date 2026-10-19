import { apiClient } from './client';

/**
 * The configuration facts the `/for-admins` page shows a Workspace admin
 * (Phase 2 Step 5a). Fetched rather than hardcoded because an admin allowlists
 * on the strength of these exact values, and a client-side copy of the OAuth
 * client id would be a second place for it to go stale — a failure that would
 * present as a teacher still locked out after their admin did everything right.
 *
 * Public: the client id appears in every consent redirect and the scopes appear
 * on the consent screen itself.
 */
export interface AppInfo {
  appName: string;
  /** Empty on an unconfigured deployment; the page renders a fallback rather than a blank field. */
  oauthClientId: string;
  scopes: string[];
}

export function getAppInfo(): Promise<AppInfo> {
  return apiClient.get<AppInfo>('/public/app-info');
}
