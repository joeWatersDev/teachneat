export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  goesBy: string | null;
  pronouns: string | null;
  courses: string[];
  /** Subset of `courses` in which the student is flagged as at academic risk. */
  atRiskCourses: string[];
  studentEmail: string | null;
  parentEmails: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
