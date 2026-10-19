export type GroupingConstraintTypeKey = 'together' | 'apart';

export interface GroupingConstraint {
  id: string;
  constraintTypeKey: GroupingConstraintTypeKey;
  studentIds: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  studentIds: string[];
}

export interface Grouping {
  /** null until saved. */
  id: string | null;
  groupSize: number | null;
  groupCount: number | null;
  groups: Group[];
  generatedAt: string;
  savedAt: string | null;
}

/** Whether the teacher is targeting a students-per-group size or a number of groups. */
export type GroupingMode = 'size' | 'count';
