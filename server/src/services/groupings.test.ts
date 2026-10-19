import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent } from './students.js';
import { createConstraint } from './groupingConstraints.js';
import { generateGrouping, saveCurrentGrouping, getCurrentGrouping } from './groupings.js';
import { readTabRowsIndexed, isActive } from './sheets.js';

const USER = 'user-sub-1';
const COURSE = 'Math';

async function setup(count: number, course = COURSE) {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  const studentIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: `First${i}`,
      lastName: `Last${i}`,
      courses: [course],
    });
    studentIds.push(s.id);
  }
  return { env, sheets, spreadsheetId, studentIds };
}

function flat(groups: { studentIds: string[] }[]): string[] {
  return groups.flatMap((g) => g.studentIds).sort();
}

describe('groupings service', () => {
  beforeEach(() => clearCache());

  it('generates groups scoped to the course population', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(9);
    const g = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 3 });
    expect(g.id).toBeNull();
    expect(g.savedAt).toBeNull();
    expect(g.groupSize).toBe(3);
    expect(g.groupCount).toBeNull();
    expect(g.groups).toHaveLength(3);
    expect(flat(g.groups)).toEqual([...studentIds].sort());
  });

  it('excludes students not enrolled in the requested course', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(4);
    // A student only in another course must not appear.
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Other',
      lastName: 'Course',
      courses: ['Science'],
    });
    const g = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupCount: 2 });
    expect(flat(g.groups)).toEqual([...studentIds].sort());
  });

  it('applies stored constraints during generation', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(8);
    await createConstraint(sheets, spreadsheetId, USER, {
      constraintTypeKey: 'apart',
      studentIds: [studentIds[0], studentIds[1]],
    });
    for (let i = 0; i < 10; i++) {
      const g = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupCount: 2 });
      const withFirst = g.groups.find((grp) => grp.studentIds.includes(studentIds[0]))!;
      expect(withFirst.studentIds).not.toContain(studentIds[1]);
    }
  });

  it('applies ad-hoc constraints passed inline', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(6);
    const g = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 2 }, [
      { constraintTypeKey: 'together', studentIds: [studentIds[0], studentIds[1]] },
    ]);
    const withFirst = g.groups.find((grp) => grp.studentIds.includes(studentIds[0]))!;
    expect(withFirst.studentIds).toContain(studentIds[1]);
  });

  it('returns null when a course has no saved grouping', async () => {
    const { sheets, spreadsheetId } = await setup(4);
    expect(await getCurrentGrouping(sheets, spreadsheetId, USER, COURSE)).toBeNull();
  });

  it('saves the current grouping for a course and reads it back', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(6);
    const g = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 2 });
    const saved = await saveCurrentGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 2 }, g.groups);
    expect(saved.id).not.toBeNull();
    expect(saved.savedAt).not.toBeNull();

    const loaded = await getCurrentGrouping(sheets, spreadsheetId, USER, COURSE);
    expect(loaded).not.toBeNull();
    expect(loaded!.groupSize).toBe(2);
    expect(flat(loaded!.groups)).toEqual([...studentIds].sort());
  });

  it('overwrites the prior grouping for the same course (one current per class)', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(6);
    const g1 = await generateGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 2 });
    await saveCurrentGrouping(sheets, spreadsheetId, USER, COURSE, { groupSize: 2 }, g1.groups);
    // A manually edited arrangement: everyone in one group.
    await saveCurrentGrouping(sheets, spreadsheetId, USER, COURSE, { groupCount: 2 }, [
      { studentIds },
    ]);

    const loaded = await getCurrentGrouping(sheets, spreadsheetId, USER, COURSE);
    expect(loaded!.groups).toHaveLength(1);
    expect(loaded!.groupCount).toBe(2);
    expect(loaded!.groupSize).toBeNull();
    expect(flat(loaded!.groups)).toEqual([...studentIds].sort());
  });

  it('keeps each course’s current grouping independent', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(4);
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Other',
      lastName: 'Class',
      courses: ['Science'],
    });
    await saveCurrentGrouping(sheets, spreadsheetId, USER, COURSE, { groupCount: 2 }, [
      { studentIds: studentIds.slice(0, 2) },
      { studentIds: studentIds.slice(2) },
    ]);

    expect(await getCurrentGrouping(sheets, spreadsheetId, USER, 'Science')).toBeNull();
    const math = await getCurrentGrouping(sheets, spreadsheetId, USER, COURSE);
    expect(flat(math!.groups)).toEqual([...studentIds].sort());
  });
});

/**
 * Auto-save fires on every generate, drag-move and reorder, so anything that
 * writes new rows per save turns ordinary use into unbounded growth. These
 * assert on the tab's real row count, not on what the reader returns, because
 * the reader filtered tombstones out and so reported the same answer either way
 * while the sheet grew into the thousands.
 */
describe('grouping row reuse', () => {
  beforeEach(() => clearCache());

  async function tabRows(
    sheets: Parameters<typeof getCurrentGrouping>[0],
    spreadsheetId: string,
  ): Promise<{ total: number; active: number }> {
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'groupings');
    return { total: rows.length, active: rows.filter((r) => isActive(r.obj)).length };
  }

  async function save(
    sheets: Parameters<typeof getCurrentGrouping>[0],
    spreadsheetId: string,
    ids: string[],
    groupSize: number,
    course = COURSE,
  ) {
    const groups = [];
    for (let i = 0; i < ids.length; i += groupSize) {
      groups.push({ studentIds: ids.slice(i, i + groupSize) });
    }
    return saveCurrentGrouping(sheets, spreadsheetId, USER, course, { groupSize }, groups);
  }

  it('writes no new rows when the arrangement is re-saved at the same group count', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(12);
    await save(sheets, spreadsheetId, studentIds, 3); // four groups
    const after1 = await tabRows(sheets, spreadsheetId);
    expect(after1).toEqual({ total: 4, active: 4 });

    // What a teacher dragging students around produces: several saves, same
    // group count. Before the fix this was twenty rows, sixteen of them dead.
    for (let i = 0; i < 4; i++) {
      await save(sheets, spreadsheetId, [...studentIds].reverse(), 3);
    }
    expect(await tabRows(sheets, spreadsheetId)).toEqual({ total: 4, active: 4 });
  });

  it('reuses its own tombstones before appending when the group count grows', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(12);
    await save(sheets, spreadsheetId, studentIds, 3); // four groups
    await save(sheets, spreadsheetId, studentIds, 6); // two groups, two tombstoned
    expect(await tabRows(sheets, spreadsheetId)).toEqual({ total: 4, active: 2 });

    // Back to four groups: the two dead rows are taken over rather than appended to.
    await save(sheets, spreadsheetId, studentIds, 3);
    expect(await tabRows(sheets, spreadsheetId)).toEqual({ total: 4, active: 4 });
  });

  it('settles at the high-water mark of group count rather than growing', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(12);
    // Oscillating between two, four and six groups, repeatedly.
    for (let i = 0; i < 5; i++) {
      await save(sheets, spreadsheetId, studentIds, 6);
      await save(sheets, spreadsheetId, studentIds, 3);
      await save(sheets, spreadsheetId, studentIds, 2);
    }
    // Six groups is the most ever used, so six rows is the most ever held.
    expect((await tabRows(sheets, spreadsheetId)).total).toBe(6);
  });

  it('reads back the current arrangement after shrinking the group count', async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(12);
    await save(sheets, spreadsheetId, studentIds, 3);
    clearCache();
    await save(sheets, spreadsheetId, studentIds, 6);
    clearCache();

    const current = await getCurrentGrouping(sheets, spreadsheetId, USER, COURSE);
    expect(current?.groups).toHaveLength(2);
    expect(flat(current?.groups ?? [])).toEqual([...studentIds].sort());
  });

  it("leaves another class's rows alone", async () => {
    const { sheets, spreadsheetId, studentIds } = await setup(6);
    const other = [];
    for (let i = 0; i < 6; i++) {
      const s = await createStudent(sheets, spreadsheetId, USER, {
        firstName: `Other${i}`,
        lastName: 'X',
        courses: ['Science'],
      });
      other.push(s.id);
    }
    clearCache();

    await save(sheets, spreadsheetId, other, 2, 'Science'); // three groups
    await save(sheets, spreadsheetId, studentIds, 3); // two groups
    // Shrinking Math must not disturb Science.
    await save(sheets, spreadsheetId, studentIds, 6); // one group
    clearCache();

    const science = await getCurrentGrouping(sheets, spreadsheetId, USER, 'Science');
    expect(science?.groups).toHaveLength(3);
    expect(flat(science?.groups ?? [])).toEqual([...other].sort());
  });
});
