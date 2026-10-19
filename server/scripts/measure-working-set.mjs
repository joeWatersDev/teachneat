// Measures the real heap cost of one teacher's working set, per resource, and
// what it implies for MAX_CACHE_BYTES and ESTIMATED_BYTES_PER_ROW in
// src/config/cache.ts.
//
//   node --expose-gc scripts/measure-working-set.mjs
//
// Committed because the ceiling it produced is a measurement rather than a
// judgement, and the shapes below drift: a change to Student, AttendanceRecord,
// Enrollment, IepRecord or Grouping, or to how much a teacher archives, moves
// the answer. Re-run it rather than trusting the constant.
//
// Updated in Step 8 from the v4 shapes it was written against. What changed:
// attendance is exceptions plus class-day markers rather than a row per student
// per day (6k), and it caches an AttendanceSnapshot object rather than a flat
// array; groupings caches a Map<string, Grouping> rather than a list;
// groupingConstraints is cached and was missing here entirely; CourseRecord
// carries archivedAt rather than an archived boolean; and the attendance loader
// interns its repeated strings, which is a large part of its footprint and was
// not modelled.
//
// The profile modelled is a deliberately unfavourable one: a full timetable of
// five classes, a full unarchived school year, and no archiving. Class archiving
// (Step 6e) is what a real teacher uses to stay well under it.
const ulid = (n) => ('01J' + n.toString(36).padStart(23, '0')).slice(0, 26);
const iso = '2026-03-14T09:15:00.000Z';

/**
 * How many independent teachers are measured per resource, with the result
 * divided back down to one.
 *
 * Not a refinement — without it the script does not work any more. Step 6k took
 * attendance from 27,000 rows to about 2,800, and one teacher's whole working
 * set now moves the heap by well under a megabyte, which is inside the noise of
 * a `global.gc()` pair: the first run of this version reported *negative* heap
 * for attendance and for groupings. Measuring a batch puts the delta an order of
 * magnitude above that noise, and it is also the shape of the real question,
 * which was never about one teacher.
 */
const TEACHERS = Number.parseInt(process.env.TEACHERS ?? '25', 10);

const CLASSES = 5;
const PER_CLASS = 30;
const UNIQUE_STUDENTS = 120;
const SCHOOL_DAYS = 180;
const SEATS = CLASSES * PER_CLASS;

/**
 * Share of (student, class-day) pairs that earn a stored row. Present is
 * inferred and never written, so this is the only thing that makes attendance
 * grow with the year. 7% of a full timetable is the ~1,890 exceptions the
 * attendance service's own header cites against 27,000 dense v4 rows.
 */
const EXCEPTION_RATE = 0.07;

/**
 * Every fixture is a function of a teacher index `t`, and every identifier and
 * class name it produces is distinct per teacher. That distinctness is
 * load-bearing: V8 internalises strings across `JSON.parse` calls, so parsing
 * twenty copies of one teacher's data would share one set of strings between
 * them and understate what twenty real teachers cost.
 *
 * Dates are deliberately *not* salted. Every teacher's calendar really does
 * contain '2026-03-14', so sharing those strings is the production behaviour
 * rather than an artifact.
 */
const idFor = (t, n) => ulid(t * 1_000_000 + n);
const coursesFor = (t) => Array.from({ length: CLASSES }, (_, i) => `SNC${t}D-0${i + 1}`);
const dateFor = (d) =>
  `2026-${String((d % 12) + 1).padStart(2, '0')}-${String((d % 28) + 1).padStart(2, '0')}`;

function students(t) {
  const courses = coursesFor(t);
  return Array.from({ length: UNIQUE_STUDENTS }, (_, i) => ({
    id: idFor(t, i), firstName: `Genevieve${t}`, lastName: `Okonkwo-Ferreira${t}`,
    goesBy: i % 4 === 0 ? 'Gen' : null, pronouns: i % 3 === 0 ? 'she/her' : null,
    courses: [courses[i % CLASSES]], atRiskCourses: i % 9 === 0 ? [courses[i % CLASSES]] : [],
    studentEmail: `student${t}-${i}@dsbn.example.org`,
    parentEmails: [`parent${t}-${i}a@example.com`, `parent${t}-${i}b@example.com`],
    notes: i % 7 === 0 ? 'Prefers seat near the front; check in about missed labs.' : null,
    createdAt: iso, updatedAt: iso,
  }));
}

function enrollments(t) {
  const courses = coursesFor(t);
  return Array.from({ length: SEATS }, (_, i) => ({
    id: idFor(t, i + 1000), studentId: idFor(t, i % UNIQUE_STUDENTS),
    course: courses[i % CLASSES], atRisk: i % 11 === 0, createdAt: iso,
    startDate: i % 20 === 0 ? '2026-11-03' : null,
  }));
}

/**
 * Raw active rows as the Sheets read returns them, before splitRows partitions
 * them. Both kinds live in one tab, so both are parsed out of one response.
 */
function attendanceRows(t) {
  const courses = coursesFor(t);
  const out = [];
  const statuses = ['a', 't', 'e'];
  const stride = Math.round(1 / EXCEPTION_RATE);
  let n = 0;
  for (let d = 0; d < SCHOOL_DAYS; d++) {
    const date = dateFor(d);
    for (let c = 0; c < CLASSES; c++) {
      // Rule 1 of the attendance design: a marker every class-day, always.
      out.push({
        id: idFor(t, n++ + 5000), studentId: '', course: courses[c], date,
        statusKey: 'd', notes: null, createdAt: iso, updatedAt: iso,
      });
    }
    for (let s = 0; s < SEATS; s++) {
      if ((d * SEATS + s) % stride !== 0) continue;
      out.push({
        id: idFor(t, n++ + 5000), studentId: idFor(t, s % UNIQUE_STUDENTS),
        course: courses[s % CLASSES], date, statusKey: statuses[n % 3],
        notes: n % 12 === 0 ? 'Called home, no answer' : null,
        createdAt: iso, updatedAt: iso,
      });
    }
  }
  return out;
}

/**
 * The cached value: exceptions and markers split apart, repeated strings pooled,
 * and createdAt/updatedAt dropped. Mirrors splitRows + createInterner in
 * services/attendance.ts, which is where the real shape is defined.
 */
function attendanceSnapshot(rows) {
  const pool = new Map();
  const it = (v) => {
    if (v === null) return null;
    const held = pool.get(v);
    if (held !== undefined) return held;
    pool.set(v, v);
    return v;
  };
  const records = [];
  const classDays = [];
  for (const obj of rows) {
    if (obj.statusKey === 'd') {
      classDays.push({ course: it(obj.course), date: it(obj.date) });
    } else {
      records.push({
        id: String(obj.id), studentId: it(obj.studentId), course: it(obj.course),
        date: it(obj.date), statusKey: it(obj.statusKey), notes: it(obj.notes),
      });
    }
  }
  return { records, classDays };
}

function iepAll(t) {
  const keys = ['extraTime', 'quietSpace', 'assistiveTech', 'chunking', 'scribe'];
  const out = [];
  for (let i = 0; i < UNIQUE_STUDENTS; i++) {
    if (i % 5 !== 0) continue;
    for (let k = 0; k < 3; k++) out.push({
      id: idFor(t, i * 10 + k + 90000), studentId: idFor(t, i), accommodationKey: keys[k],
      enabled: true, notes: 'Per IEP, section 4.', updatedAt: iso,
    });
  }
  return out;
}

/** One saved grouping per class, which is what the tab holds after the 6k follow-up. */
function groupingRows(t) {
  return coursesFor(t).map((course, c) => ({
    id: idFor(t, c + 400000), course, groupSize: 4, groupCount: null,
    groups: Array.from({ length: Math.ceil(PER_CLASS / 4) }, (_, g) => ({
      studentIds: Array.from(
        { length: 4 },
        (_, m) => idFor(t, (c * PER_CLASS + g * 4 + m) % UNIQUE_STUDENTS),
      ),
    })),
    generatedAt: iso, savedAt: iso,
  }));
}

function groupingConstraints(t) {
  return Array.from({ length: 12 }, (_, i) => ({
    id: idFor(t, i + 500000), constraintTypeKey: i % 2 === 0 ? 'apart' : 'together',
    studentIds: [idFor(t, i), idFor(t, i + 1)],
    notes: 'Keep separated during group work.', createdAt: iso, updatedAt: iso,
  }));
}

function templates(t) {
  return Array.from({ length: 8 }, (_, i) => ({
    id: idFor(t, i + 200000), name: `Absence follow-up ${t}-${i}`,
    subject: 'Regarding {{firstName}} in {{course}}',
    bodyHtml: '<p>Hello,</p><p>' + 'x'.repeat(400) + '</p><p>{{teacherName}}</p>',
    placeholdersUsed: ['firstName', 'course', 'teacherName'],
    createdAt: iso, updatedAt: iso,
  }));
}

/**
 * Each entry is one key in the working set. `rows` builds the JSON-serializable
 * source; `build` turns parsed rows into the value actually cached, for the two
 * resources whose cached shape is not the parsed shape.
 */
const resources = {
  students: { rows: students },
  enrollments: { rows: enrollments },
  attendance: { rows: attendanceRows, build: attendanceSnapshot },
  'iep-all': { rows: iepAll },
  courses: {
    rows: (t) => coursesFor(t).map((c, i) => ({
      id: idFor(t, i + 300000), name: c, createdAt: iso, archivedAt: null,
    })),
  },
  groupings: {
    rows: groupingRows,
    build: (rows) => new Map(rows.map((g) => [g.course, g])),
  },
  groupingConstraints: { rows: groupingConstraints },
  emailTemplates: { rows: templates },
};

/** Mirrors countRows in services/cache.ts — the row count the byte estimate uses. */
function countRows(value, depth = 0) {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Set) return value.size;
  if (depth >= 3) return 0;
  if (value instanceof Map) {
    let total = 0;
    for (const entry of value.values()) total += countRows(entry, depth + 1);
    return Math.max(total, value.size);
  }
  let total = 0;
  for (const entry of Object.values(value)) total += countRows(entry, depth + 1);
  return total;
}

/**
 * Rows are round-tripped through JSON before being measured, and that is not a
 * formality. V8 internalises repeated strings during `JSON.parse`, so the same
 * rows cost substantially more when constructed field by field than when parsed.
 * Production reads them from the Sheets API as a parsed JSON response, so the
 * parsed figure is the real one; building them directly here overstated the
 * working set by about 60% when this was first measured.
 *
 * `build` runs inside the measured window on purpose: its input is the parsed
 * rows, which become garbage the moment it returns, so what the two GC pairs
 * bracket is exactly what the cache retains.
 *
 * The JSON strings for all {@link TEACHERS} copies are built *before* the window
 * opens, so their own bytes are not charged to the result.
 */
function measure({ rows, build }) {
  const raws = Array.from({ length: TEACHERS }, (_, t) => JSON.stringify(rows(t)));
  global.gc(); global.gc();
  const before = process.memoryUsage().heapUsed;
  const held = raws.map((raw) => (build ? build(JSON.parse(raw)) : JSON.parse(raw)));
  global.gc(); global.gc();
  const after = process.memoryUsage().heapUsed;
  return {
    heap: (after - before) / TEACHERS,
    json: Buffer.byteLength(raws[0]),
    count: countRows(held[0]),
    held,
  };
}

let totalHeap = 0, totalJson = 0, totalRows = 0;
const keep = [];
console.log(`Averaged over ${TEACHERS} independent teachers per resource.`);
console.log('');
console.log('resource             rows      heap(MB)   json(MB)  heap/row');
for (const [name, spec] of Object.entries(resources)) {
  const r = measure(spec);
  keep.push(r.held);
  totalHeap += r.heap; totalJson += r.json; totalRows += r.count;
  console.log(
    name.padEnd(19),
    String(r.count).padStart(7),
    (r.heap / 1048576).toFixed(2).padStart(10),
    (r.json / 1048576).toFixed(2).padStart(10),
    (r.heap / Math.max(r.count, 1)).toFixed(0).padStart(9),
  );
}
console.log('-'.repeat(66));
console.log('TOTAL per teacher   heap', (totalHeap / 1048576).toFixed(2), 'MB   json', (totalJson / 1048576).toFixed(2), 'MB');
console.log('entries per teacher:', Object.keys(resources).length, '  counted rows:', totalRows);
console.log('');

// What ESTIMATED_BYTES_PER_ROW should be: the weighted mean over every row the
// cache counts, since that constant is applied uniformly to all of them.
console.log('weighted mean bytes/row (ESTIMATED_BYTES_PER_ROW):', (totalHeap / totalRows).toFixed(0));
console.log('');
for (const budget of [512, 700, 850]) {
  console.log('teachers that fit in ' + budget + ' MB of heap:', Math.floor(budget / (totalHeap / 1048576)));
}
const budgetMb = Number.parseInt(process.env.CACHE_MAX_MB ?? '256', 10);
console.log('CACHE_MAX_MB=' + budgetMb + ' holds teachers:', Math.floor(budgetMb / (totalHeap / 1048576)));
