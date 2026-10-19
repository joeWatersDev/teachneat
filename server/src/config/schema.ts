export const SCHEMA_VERSION = '6';

/**
 * The identifiers this app writes onto the teacher's Drive (Phase 2 Step 6g).
 *
 * The two marker keys below are how bootstrap finds an already-created folder
 * and spreadsheet — `appProperties` first, then the marker row in `meta` as a
 * fallback — so changing them makes every file created under the old names
 * undiscoverable. That was acceptable exactly once, while a single account
 * existed and its owner ported the data by hand. **Treat these as frozen.** A
 * later change is a migration with a dual-read fallback and a backfill, not a
 * rename.
 */
/**
 * Written once into `meta.appId` and read by nothing, which is why it keeps the
 * old prefix while the five constants below move (TESTING_PLAN, Step 6g). It is
 * internal, no teacher ever sees it, and changing it would put the freshly
 * seeded value at odds with a hand-ported meta tab for no gain.
 */
export const APP_ID = 'ttk';
export const APP_PROPERTY_KEY = 'tn_app';
export const APP_PROPERTY_VALUE = 'v1';
export const APP_MARKER_KEY = 'TN_APP_MARKER';

/**
 * The app's own folder on the teacher's Drive, so its spreadsheet does not sit
 * loose at the Drive root. Marked with the same appProperties key as the
 * spreadsheet but a distinct value, so each is found by its own query.
 */
export const APP_FOLDER_NAME = 'TEACHNEAT DATA';
export const APP_FOLDER_PROPERTY_VALUE = 'folder-v1';
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Marks a spreadsheet as having been filed into the app folder once. The
 * `drive.file` scope cannot read the Drive root or any folder the app did not
 * create, so there is no way to ask "is this file still where we left it" — the
 * marker is what keeps the move a one-time migration instead of a filing
 * preference the app re-imposes on every sign-in.
 */
export const APP_FILED_KEY = 'tn_filed';
export const APP_FILED_VALUE = 'v1';

export type TabName =
  | 'meta'
  | 'students'
  | 'enrollments'
  | 'iep'
  | 'attendance'
  | 'emailTemplates'
  | 'emailLog'
  | 'attendanceRules'
  | 'emailQueue'
  | 'groupingConstraints'
  | 'groupings'
  | 'courses'
  | 'enrollmentsArchive'
  | 'attendanceArchive'
  | 'groupingsArchive'
  | 'studentsArchive';

export interface ColumnSpec {
  code: string;
  field: string;
}

export interface TabSpec {
  name: TabName;
  columns: ColumnSpec[];
}

/**
 * Shared by `attendance` and `attendanceArchive`. Declared once rather than
 * written twice: the move operation copies rows between the two without
 * transforming them, so a divergence between the two column lists would corrupt
 * every archived attendance row.
 *
 * From schemaVersion 5 this tab holds two kinds of row (Step 6k). An **exception
 * row** is one student's non-present mark, exactly as before. A **class-day
 * marker** records that attendance was taken for one course on one date: it
 * carries `course` and `date`, an empty `studentId`, and `CLASS_DAY_MARKER_KEY`
 * in `statusKey`. Present is inferred from a marked day with no exception row,
 * which is why the marker is load-bearing rather than bookkeeping — without it
 * a perfectly-attended class-day is indistinguishable from one nobody recorded.
 *
 * Both kinds live in one tab on purpose. They are read in one call and cached as
 * one entry, a save writes the marker and its exceptions in a single append (so
 * the two cannot diverge), and class archiving moves markers with no code of its
 * own because they carry `course` like every other row here.
 */
const ATTENDANCE_COLUMNS: ColumnSpec[] = [
  { code: 'c01', field: 'id' },
  { code: 'c02', field: 'studentId' },
  { code: 'c03', field: 'date' },
  { code: 'c04', field: 'statusKey' },
  { code: 'c05', field: 'notes' },
  { code: 'c06', field: 'createdAt' },
  { code: 'c07', field: 'updatedAt' },
  { code: 'c08', field: 'deletedAt' },
  { code: 'c09', field: 'course' },
];

/**
 * Shared by `enrollments` and `enrollmentsArchive`, for the same reason
 * `ATTENDANCE_COLUMNS` is shared.
 *
 * `startDate` (schemaVersion 5, Step 6k) is the date the student joined the
 * class. It exists because inferring present from the absence of a row needs to
 * know which days a student was actually in the class: without it, a student who
 * joined in November would be inferred present for every marked class-day in
 * September and their absence rate computed against a denominator covering weeks
 * before they arrived. Empty means unbounded — **not** a fallback to `createdAt`,
 * which is when the row was written rather than when the student joined, and so
 * would clamp away a teacher's backdated entry. It is stamped automatically when
 * an enrollment is created, at the day after the course's last recorded
 * class-day, and left empty for a course that has never been recorded.
 */
const ENROLLMENT_COLUMNS: ColumnSpec[] = [
  { code: 'c01', field: 'id' },
  { code: 'c02', field: 'studentId' },
  { code: 'c03', field: 'course' },
  { code: 'c04', field: 'createdAt' },
  { code: 'c05', field: 'deletedAt' },
  { code: 'c06', field: 'atRisk' },
  { code: 'c07', field: 'startDate' },
];

export const TABS: Record<TabName, TabSpec> = {
  meta: {
    name: 'meta',
    columns: [
      { code: 'c01', field: 'key' },
      { code: 'c02', field: 'value' },
    ],
  },
  students: {
    name: 'students',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'firstName' },
      { code: 'c03', field: 'lastName' },
      { code: 'c04', field: 'goesBy' },
      { code: 'c05', field: 'pronouns' },
      { code: 'c06', field: 'studentEmail' },
      { code: 'c07', field: 'parentEmails' },
      { code: 'c08', field: 'notes' },
      { code: 'c09', field: 'createdAt' },
      { code: 'c10', field: 'updatedAt' },
      { code: 'c11', field: 'deletedAt' },
    ],
  },
  enrollments: {
    name: 'enrollments',
    columns: ENROLLMENT_COLUMNS,
  },
  /**
   * Retained deliberately, and read and written by nothing (Phase 2 Step 8a).
   *
   * The IEP surface was removed from the product permanently: the risk that
   * attaches to special education records is not worth the feature at any
   * point on the roadmap. The tab definition stays and bootstrap goes on
   * creating it, because removing it would mean a `schemaVersion` bump and a
   * non-additive migration decision about tabs already carrying a teacher's
   * rows. Leaving it in place costs one unused tab per sheet and preserves what
   * a teacher already wrote, on their own Drive, where we cannot orphan it.
   *
   * Do not build against this. Anything that reads it is reintroducing the
   * feature.
   */
  iep: {
    name: 'iep',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'studentId' },
      { code: 'c03', field: 'accommodationKey' },
      { code: 'c04', field: 'enabled' },
      { code: 'c05', field: 'notes' },
      { code: 'c06', field: 'updatedAt' },
      { code: 'c07', field: 'deletedAt' },
    ],
  },
  attendance: {
    name: 'attendance',
    columns: ATTENDANCE_COLUMNS,
  },
  emailTemplates: {
    name: 'emailTemplates',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'name' },
      { code: 'c03', field: 'subject' },
      { code: 'c04', field: 'bodyHtml' },
      { code: 'c05', field: 'placeholdersUsed' },
      { code: 'c06', field: 'createdAt' },
      { code: 'c07', field: 'updatedAt' },
      { code: 'c08', field: 'deletedAt' },
    ],
  },
  emailLog: {
    name: 'emailLog',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'templateId' },
      { code: 'c03', field: 'recipientAddress' },
      { code: 'c04', field: 'recipientStudentId' },
      { code: 'c05', field: 'sentAt' },
      { code: 'c06', field: 'statusKey' },
      { code: 'c07', field: 'errorCode' },
    ],
  },
  attendanceRules: {
    name: 'attendanceRules',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'ruleTypeKey' },
      { code: 'c03', field: 'threshold' },
      { code: 'c04', field: 'windowDays' },
      { code: 'c05', field: 'templateId' },
      { code: 'c06', field: 'enabled' },
      { code: 'c07', field: 'createdAt' },
      { code: 'c08', field: 'updatedAt' },
      { code: 'c09', field: 'deletedAt' },
    ],
  },
  emailQueue: {
    name: 'emailQueue',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'ruleId' },
      { code: 'c03', field: 'studentId' },
      { code: 'c04', field: 'triggeredAt' },
      { code: 'c05', field: 'statusKey' },
      { code: 'c06', field: 'reviewedAt' },
      { code: 'c07', field: 'sentLogId' },
    ],
  },
  groupingConstraints: {
    name: 'groupingConstraints',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'constraintTypeKey' },
      { code: 'c03', field: 'studentIds' },
      { code: 'c04', field: 'notes' },
      { code: 'c05', field: 'createdAt' },
      { code: 'c06', field: 'updatedAt' },
      { code: 'c07', field: 'deletedAt' },
    ],
  },
  groupings: {
    name: 'groupings',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'groupingId' },
      { code: 'c03', field: 'groupIndex' },
      { code: 'c04', field: 'studentIds' },
      { code: 'c05', field: 'groupSize' },
      { code: 'c06', field: 'groupCount' },
      { code: 'c07', field: 'savedAt' },
      { code: 'c08', field: 'deletedAt' },
      { code: 'c09', field: 'course' },
    ],
  },
  /**
   * The teacher's classes as records (schemaVersion 4, for class archiving).
   * Before this, a class existed only as repeated text on enrollment rows, so it
   * could not be archived, renamed, or told apart from another class of the same
   * name. `name` stays the join key — enrollment and attendance rows still carry
   * the course string — which is what keeps the change additive.
   */
  courses: {
    name: 'courses',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'name' },
      { code: 'c03', field: 'createdAt' },
      { code: 'c04', field: 'archivedAt' },
      { code: 'c05', field: 'deletedAt' },
    ],
  },
  /**
   * Archive tabs. Each mirrors its live counterpart's columns exactly, so a row
   * moves without transformation and moves back the same way. Pure cold storage:
   * nothing reads them except the unarchive operation.
   */
  enrollmentsArchive: {
    name: 'enrollmentsArchive',
    columns: ENROLLMENT_COLUMNS,
  },
  attendanceArchive: {
    name: 'attendanceArchive',
    columns: ATTENDANCE_COLUMNS,
  },
  groupingsArchive: {
    name: 'groupingsArchive',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'groupingId' },
      { code: 'c03', field: 'groupIndex' },
      { code: 'c04', field: 'studentIds' },
      { code: 'c05', field: 'groupSize' },
      { code: 'c06', field: 'groupCount' },
      { code: 'c07', field: 'savedAt' },
      { code: 'c08', field: 'deletedAt' },
      { code: 'c09', field: 'course' },
    ],
  },
  studentsArchive: {
    name: 'studentsArchive',
    columns: [
      { code: 'c01', field: 'id' },
      { code: 'c02', field: 'firstName' },
      { code: 'c03', field: 'lastName' },
      { code: 'c04', field: 'goesBy' },
      { code: 'c05', field: 'pronouns' },
      { code: 'c06', field: 'studentEmail' },
      { code: 'c07', field: 'parentEmails' },
      { code: 'c08', field: 'notes' },
      { code: 'c09', field: 'createdAt' },
      { code: 'c10', field: 'updatedAt' },
      { code: 'c11', field: 'deletedAt' },
    ],
  },
};

export const TAB_ORDER: TabName[] = [
  'meta',
  'students',
  'enrollments',
  'iep',
  'attendance',
  'emailTemplates',
  'emailLog',
  'attendanceRules',
  'emailQueue',
  'groupingConstraints',
  'groupings',
  'courses',
  'enrollmentsArchive',
  'attendanceArchive',
  'groupingsArchive',
  'studentsArchive',
];

/**
 * Which live tab each archive tab shadows. The move operation is generic over
 * this pairing, and the column lists above are asserted identical in the schema
 * tests — a divergence would corrupt rows on the way across.
 */
export const ARCHIVE_OF: Record<string, TabName> = {
  enrollments: 'enrollmentsArchive',
  attendance: 'attendanceArchive',
  groupings: 'groupingsArchive',
  students: 'studentsArchive',
};

/**
 * The accommodation keys the retired `iep` tab's rows are written with. Kept
 * only so the tab's stored data stays interpretable; no code path produces or
 * consumes one. See the `iep` entry above.
 */
export const ACCOMMODATION_KEYS = ['fb', 'fci', 'nta', 'ps', 'at', 'as', 'tu'] as const;
export type AccommodationKey = (typeof ACCOMMODATION_KEYS)[number];

/**
 * The statuses a teacher can give a student. This is the API surface and has not
 * changed: `p` is still submitted, returned and rendered exactly as before.
 *
 * What changed in schemaVersion 5 is only how `p` is *stored*, which is that it
 * is not. See `EXCEPTION_STATUS_KEYS`.
 */
export const ATTENDANCE_STATUS_KEYS = ['p', 'a', 't', 'e'] as const;
export type AttendanceStatusKey = (typeof ATTENDANCE_STATUS_KEYS)[number];

/**
 * The statuses that earn a stored row (Step 6k). Present is inferred from a
 * marked class-day with no exception row, so it is never written; a teacher
 * changing a student back to present deletes the row rather than rewriting it.
 */
export const EXCEPTION_STATUS_KEYS = ['a', 't', 'e'] as const;
export type ExceptionStatusKey = (typeof EXCEPTION_STATUS_KEYS)[number];

export function isExceptionStatus(key: string): key is ExceptionStatusKey {
  return (EXCEPTION_STATUS_KEYS as readonly string[]).includes(key);
}

/**
 * The `statusKey` value that marks a row as a class-day marker rather than a
 * student's mark. Deliberately outside `ATTENDANCE_STATUS_KEYS`: the request
 * schemas validate against that union, so a marker cannot be submitted through
 * the API, and no marker can be mistaken for a status the client knows how to
 * render.
 */
export const CLASS_DAY_MARKER_KEY = 'd';

export const GROUPING_CONSTRAINT_TYPE_KEYS = ['together', 'apart'] as const;
export type GroupingConstraintTypeKey = (typeof GROUPING_CONSTRAINT_TYPE_KEYS)[number];

export function headerRowForTab(tab: TabName): string[] {
  return TABS[tab].columns.map((c) => c.code);
}
