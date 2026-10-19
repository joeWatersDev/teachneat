import { apiClient } from './client';

export type SupportCategory = 'question' | 'bug' | 'billing' | 'feature' | 'other';
export type SupportStatus = 'new' | 'open' | 'resolved' | 'closed';

export interface SupportRequest {
  id: string;
  /** Null for a request sent from the signed-out contact form on the landing page. */
  googleSub: string | null;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportStatus;
  adminNote: string;
  /** The plan the account held when the request was written. */
  planAtSubmit: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The triage view's shape: the request plus whoever sent it. For an
 * account-backed request the contact fields are the account's; for a signed-out
 * one they are what the sender typed, and `verifiedIdentity` is false so the
 * view can say which it is looking at.
 */
export interface SupportRequestWithAccount extends SupportRequest {
  accountEmail: string;
  accountName: string;
  verifiedIdentity: boolean;
  currentPlanOverride: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

/** The signed-out contact form's body. Public: no session, no CSRF token. */
export interface PublicContactRequest {
  name: string;
  email: string;
  category: SupportCategory;
  subject: string;
  message: string;
  /**
   * The honeypot. Rendered off-screen and left empty by a person; the server
   * discards anything that arrives with it filled in.
   */
  website?: string;
}

/**
 * Sends a message from the landing page's contact form. Returns nothing: the
 * server answers 204 and echoes no identifier back to an anonymous caller.
 */
export function sendPublicContact(input: PublicContactRequest): Promise<void> {
  return apiClient.post<void>('/public/support/contact', input);
}

/**
 * A capped list plus whether the cap cut it short. The server over-fetches by
 * one row to answer this exactly, so `truncated` is never a guess.
 */
export interface SupportPage<T> {
  requests: T[];
  truncated: boolean;
}

export interface CreateSupportRequest {
  category: SupportCategory;
  subject: string;
  message: string;
}

/**
 * The account is never sent: the server takes the submitter from the session,
 * and the plan it records comes from the account record.
 */
export function createSupportRequest(input: CreateSupportRequest): Promise<SupportRequest> {
  return apiClient.post<SupportRequest>('/support/requests', input);
}

export function listMySupportRequests(): Promise<SupportPage<SupportRequest>> {
  return apiClient.get<SupportPage<SupportRequest>>('/support/requests');
}

/**
 * Operator-only. Answers 404 for everyone else, so a caller who is not
 * allowlisted sees "not found" rather than a hint that the view exists.
 */
export function listAllSupportRequests(
  status?: SupportStatus,
): Promise<SupportPage<SupportRequestWithAccount>> {
  const query = status ? `?status=${status}` : '';
  return apiClient.get<SupportPage<SupportRequestWithAccount>>(`/support/admin/requests${query}`);
}

export function triageSupportRequest(
  id: string,
  changes: { status?: SupportStatus; adminNote?: string },
): Promise<SupportRequestWithAccount> {
  return apiClient.patch<SupportRequestWithAccount>(`/support/admin/requests/${id}`, changes);
}

/** The comp mechanism: writes `plan_override` only, never billing state. */
export function setAccountPlanOverride(
  googleSub: string,
  override: 'free' | 'trial' | 'paid' | null,
): Promise<{ googleSub: string; override: string | null }> {
  return apiClient.post(`/support/admin/accounts/${googleSub}/plan-override`, { override });
}

/** One month's counts, per tool. Mirrors the server's UsagePeriodTotals. */
export interface UsagePeriodTotals {
  period: string;
  counts: Record<UsageTool, number>;
  /** Distinct accounts that used the tool that month. Always zero on a per-account read. */
  accounts: Record<UsageTool, number>;
}

export type UsageTool = 'attendance' | 'grouping' | 'email' | 'picker';

export interface ActivationFunnel {
  signedUp: number;
  onboarded: number;
  firstStudent: number;
  firstAttendance: number;
  firstGrouping: number;
  firstPicker: number;
  firstEmail: number;
  premiumAttempt: number;
}

export interface OperatorMetrics {
  funnel: ActivationFunnel;
  signups: { period: string; count: number }[];
  usage: UsagePeriodTotals[];
  /**
   * Served by the server rather than hardcoded here, so the caveat the picker
   * column carries cannot drift from how the picker is actually counted.
   */
  pickerCountsPageOpens: boolean;
  /** The counters' retention window, in months. Stated in the privacy policy. */
  retentionMonths: number;
}

/** Operator-only, and totals only: this endpoint returns no account identifiers. */
export function getOperatorMetrics(): Promise<OperatorMetrics> {
  return apiClient.get<OperatorMetrics>('/support/admin/metrics');
}

export interface AccountActivity {
  createdAt: string;
  milestones: {
    onboardedAt: string | null;
    firstStudentAt: string | null;
    firstAttendanceAt: string | null;
    firstGroupingAt: string | null;
    firstPickerAt: string | null;
    firstEmailAt: string | null;
    firstPremiumAttemptAt: string | null;
  };
  usage: UsagePeriodTotals[];
}

/**
 * One account's activation state, for the triage view. Keyed on a google_sub
 * the operator already holds from an open request: there is deliberately no
 * search and no lookup by email, so accounts that have not written in cannot be
 * browsed.
 */
export function getAccountActivity(googleSub: string): Promise<AccountActivity> {
  return apiClient.get<AccountActivity>(`/support/admin/accounts/${googleSub}/activity`);
}
