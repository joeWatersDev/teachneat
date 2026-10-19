export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  placeholdersUsed: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateInput {
  name: string;
  subject: string;
  bodyHtml: string;
  placeholdersUsed: string[];
}

export type CopyMode = 'cc' | 'bcc';

export interface RecipientSelection {
  studentId: string;
  /** The course this send is for — scopes the course/attendance placeholders. */
  course: string;
  /** Include the student's own email if one is on file. */
  includeStudent: boolean;
  /** Include every guardian email on the student's record. */
  includeParents: boolean;
}

export interface SendEmailInput {
  templateId: string;
  recipients: RecipientSelection[];
  placeholderValues?: Record<string, Record<string, string>>;
  /** Optional teacher-entered address copied on every message. */
  copyAddress?: string;
  copyMode?: CopyMode;
}

export interface SendResult {
  sent: number;
  failed: Array<{ studentId: string; reason: string }>;
  skipped: Array<{ studentId: string; reason: 'no_email' | 'student_not_found' }>;
}

export interface SendStatus {
  sentToday: number;
  dailyCap: number;
  /** Always the lower of the allowances that apply, so it can never overstate. */
  remaining: number;
  plan?: 'free' | 'trial' | 'paid';
  /** Present only on `free`, which is the only plan with a monthly cap. */
  sentThisMonth?: number;
  monthlyCap?: number;
  remainingThisMonth?: number;
  /** When the monthly allowance resets (ISO). */
  monthlyResetsAt?: string;
}

/** Per-(student, course) attendance figures for the Compose view. Free-tier:
 * the email tool and its attendance conditions are not gated, so these come
 * from their own endpoint rather than the premium statistics read. */
export interface RecipientMetric {
  studentId: string;
  course: string;
  lateCount: number;
  unexcusedAbsences: number;
  daysRecorded: number;
  /** Computed server-side with the account's effective threshold. */
  highAbsence: boolean;
}
