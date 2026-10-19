import { apiClient } from './client';
import type {
  Group,
  Grouping,
  GroupingConstraint,
  GroupingConstraintTypeKey,
} from '../features/grouping/types';

// Group generation runs client-side (features/grouping/groupingAlgorithm.ts) so
// Regenerate is instant and mashable; only the resulting arrangement is persisted
// here (debounced). The server keeps its own POST /grouping/generate for the
// documented API, but the web client does not call it.

export interface SaveCurrentInput {
  course: string;
  groupSize?: number;
  groupCount?: number;
  groups: Group[];
}

/** Upserts the current grouping for a course (auto-save on every change). */
export function saveCurrentGrouping(input: SaveCurrentInput): Promise<Grouping> {
  return apiClient.put<Grouping>('/grouping/current', input);
}

/** The saved grouping for a course, or null when the class has none. */
export function getCurrentGrouping(course: string): Promise<Grouping | null> {
  return apiClient.get<Grouping | null>(`/grouping/current?course=${encodeURIComponent(course)}`);
}

export function listConstraints(): Promise<GroupingConstraint[]> {
  return apiClient.get<GroupingConstraint[]>('/grouping/constraints');
}

export interface ConstraintInput {
  constraintTypeKey: GroupingConstraintTypeKey;
  studentIds: string[];
  notes?: string | null;
}

export function createConstraint(input: ConstraintInput): Promise<GroupingConstraint> {
  return apiClient.post<GroupingConstraint>('/grouping/constraints', input);
}

export function updateConstraint(
  id: string,
  patch: Partial<ConstraintInput>,
): Promise<GroupingConstraint> {
  return apiClient.put<GroupingConstraint>(`/grouping/constraints/${id}`, patch);
}

export function deleteConstraint(id: string): Promise<void> {
  return apiClient.delete<void>(`/grouping/constraints/${id}`);
}
