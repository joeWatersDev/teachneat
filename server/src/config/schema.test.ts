import { describe, it, expect } from 'vitest';
import {
  APP_FILED_KEY,
  APP_FOLDER_NAME,
  APP_ID,
  APP_MARKER_KEY,
  APP_PROPERTY_KEY,
  TABS,
  TAB_ORDER,
  ARCHIVE_OF,
  headerRowForTab,
} from './schema.js';
import { SPREADSHEET_TITLE } from '../services/bootstrap.js';

/**
 * The identifiers the app writes onto the teacher's Drive (Step 6g).
 *
 * Asserted as a set rather than one at a time, because the failure this rename
 * can produce is not a wrong string — it is a *mixed* pair, one discovery path
 * reading the old name while another writes the new one, which makes an
 * existing spreadsheet invisible and silently creates a second.
 */
describe('Drive identifiers', () => {
  it('carries the Teachneat names and the tn_ markers, all five together', () => {
    expect({
      folder: APP_FOLDER_NAME,
      spreadsheet: SPREADSHEET_TITLE,
      property: APP_PROPERTY_KEY,
      marker: APP_MARKER_KEY,
      filed: APP_FILED_KEY,
    }).toEqual({
      folder: 'TEACHNEAT DATA',
      spreadsheet: 'Teachneat Data',
      property: 'tn_app',
      marker: 'TN_APP_MARKER',
      filed: 'tn_filed',
    });
  });

  it('leaves meta.appId on the old prefix, which is internal and unread', () => {
    // Deliberate (TESTING_PLAN, Step 6g): nothing reads it, no teacher sees it,
    // and changing it would put the freshly seeded value at odds with a
    // hand-ported meta tab. Asserted so the next sweep does not "finish the job".
    expect(APP_ID).toBe('ttk');
  });
});

describe('schema constants', () => {
  it('lists all 16 tabs from SHEETS_SCHEMA.md', () => {
    expect(new Set(TAB_ORDER)).toEqual(
      new Set([
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
        // schemaVersion 4, class archiving.
        'courses',
        'enrollmentsArchive',
        'attendanceArchive',
        'groupingsArchive',
        'studentsArchive',
      ]),
    );
  });

  it('courses tab records a class so it can be archived and told apart', () => {
    expect(TABS.courses.columns.map((c) => c.field)).toEqual([
      'id', 'name', 'createdAt', 'archivedAt', 'deletedAt',
    ]);
  });

  /**
   * The move operation copies rows between a live tab and its archive without
   * transforming them, so any divergence in the column lists would corrupt every
   * row that crosses. Asserted for all four pairs rather than trusted to review.
   */
  it('every archive tab has exactly the columns of the tab it shadows', () => {
    for (const [live, archive] of Object.entries(ARCHIVE_OF)) {
      expect(TABS[archive].columns).toEqual(TABS[live as keyof typeof TABS].columns);
    }
  });

  it('pairs an archive tab with each tab the archive operation moves', () => {
    expect(Object.keys(ARCHIVE_OF).sort()).toEqual([
      'attendance', 'enrollments', 'groupings', 'students',
    ]);
  });

  it('groupings tab has exactly the 9 columns from the schema (course-scoped current grouping)', () => {
    expect(TABS.groupings.columns.map((c) => c.field)).toEqual([
      'id', 'groupingId', 'groupIndex', 'studentIds', 'groupSize', 'groupCount', 'savedAt', 'deletedAt', 'course',
    ]);
  });

  it('students tab has exactly the 11 columns from the schema in order (no course; enrollments own it)', () => {
    expect(headerRowForTab('students')).toEqual([
      'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11',
    ]);
    expect(TABS.students.columns.map((c) => c.field)).toEqual([
      'id', 'firstName', 'lastName', 'goesBy', 'pronouns',
      'studentEmail', 'parentEmails', 'notes', 'createdAt', 'updatedAt', 'deletedAt',
    ]);
    expect(TABS.students.columns.map((c) => c.field)).not.toContain('course');
  });

  it('enrollments tab maps studentId to course with a per-class atRisk flag and start date', () => {
    expect(TABS.enrollments.columns.map((c) => c.field)).toEqual([
      'id', 'studentId', 'course', 'createdAt', 'deletedAt', 'atRisk', 'startDate',
    ]);
  });

  it('attendance tab carries course for per-class keying', () => {
    expect(TABS.attendance.columns.map((c) => c.field)).toEqual([
      'id', 'studentId', 'date', 'statusKey', 'notes', 'createdAt', 'updatedAt', 'deletedAt', 'course',
    ]);
  });

  it('iep tab has exactly the 7 columns from the schema', () => {
    expect(TABS.iep.columns.map((c) => c.field)).toEqual([
      'id', 'studentId', 'accommodationKey', 'enabled', 'notes', 'updatedAt', 'deletedAt',
    ]);
  });

  it('every column code is cNN with sequential 1-based numbering', () => {
    for (const tab of TAB_ORDER) {
      const codes = TABS[tab].columns.map((c) => c.code);
      const expected = codes.map((_, i) => `c${String(i + 1).padStart(2, '0')}`);
      expect(codes).toEqual(expected);
    }
  });

  it('emailLog does not store body content', () => {
    const fields = TABS.emailLog.columns.map((c) => c.field);
    expect(fields).not.toContain('bodyHtml');
    expect(fields).not.toContain('body');
  });
});
