import type { sheets_v4 } from 'googleapis';
import type { TabName } from '../config/schema.js';
import { cacheKey, getCached, setCached, singleFlight } from './cache.js';
import { readTabsRowsIndexed } from './sheets.js';
import { deriveStudents, STUDENTS_RESOURCE, type Student } from './students.js';
import { deriveEnrollments, enrollmentsByStudent, ENROLLMENTS_RESOURCE } from './enrollments.js';

/**
 * Collapses the roster page's cold reads into one Sheets request (Phase 2
 * Step 6a).
 *
 * Opening the roster costs two Sheets reads from cold — students and
 * enrollments, both needed to build the list — issued from a single client
 * call. That is the app's largest single burst, and it is the one that lands
 * when a staffroom signs in at the same time in the morning. Against the shared
 * 600 reads/min project ceiling, two-per-teacher supports roughly 300
 * simultaneous cold loads; one-per-teacher supports roughly 600.
 *
 * It read a third tab, `iep`, for the roster's row badges until Step 8a removed
 * the IEP surface from the product.
 *
 * Only the *cold* tabs are read, so this costs nothing when the working set is
 * warm.
 *
 * **Deliberately not a whole-workbook hydration.** The attendance tab grows a row
 * per student per class per day, so by June it dwarfs everything else combined;
 * folding it in here would make opening the roster pay for data the roster does
 * not use. It is also the tab most often invalidated by writes, so holding it
 * costs the most and buys the least. Attendance keeps its own read.
 *
 * It stays a leaf module, imported only by the route, exactly as `studentDetail`
 * is.
 */
export async function warmRoster(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<void> {
  const studentsKey = cacheKey(userKey, STUDENTS_RESOURCE);

  // Checked before the single-flight rather than inside it: a fully warm roster
  // must not pay for a promise, and this is the common case by design.
  if (getCached<Student[]>(studentsKey) !== undefined) return;

  // Keyed per user, so one teacher's warm-up never blocks another's.
  await singleFlight(cacheKey(userKey, 'roster-warm'), async () => {
    // Re-checked inside: a caller that waited on someone else's flight arrives
    // here with everything already seeded.
    if (getCached<Student[]>(studentsKey) !== undefined) return;
    const tabs: TabName[] = ['students', 'enrollments'];

    const read = await readTabsRowsIndexed(sheets, spreadsheetId, tabs);

    const enrollments = deriveEnrollments(read.get('enrollments') ?? []);
    setCached(cacheKey(userKey, ENROLLMENTS_RESOURCE), enrollments);
    setCached(
      studentsKey,
      deriveStudents(read.get('students') ?? [], enrollmentsByStudent(enrollments)),
    );
  });
}
