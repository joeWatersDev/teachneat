import { describe, it, expect } from 'vitest';
import {
  renderBody,
  renderSubject,
  extractPlaceholders,
  studentPlaceholderValues,
} from './placeholders';
import type { Student } from '../students/types';

const student: Student = {
  id: 's1',
  firstName: 'Alex',
  lastName: 'Ng',
  goesBy: 'Al',
  pronouns: 'they/them',
  courses: ['A'],
  atRiskCourses: [],
  studentEmail: null,
  parentEmails: [],
  notes: null,
  createdAt: '',
  updatedAt: '',
};

describe('email placeholders', () => {
  it('substitutes and HTML-escapes values in a body', () => {
    expect(renderBody('<p>Hi {{firstName}}</p>', { firstName: '<b>A</b>' })).toBe(
      '<p>Hi &lt;b&gt;A&lt;/b&gt;</p>',
    );
  });

  it('renders an unknown body token as empty', () => {
    expect(renderBody('Hi {{missing}}!', {})).toBe('Hi !');
  });

  it('substitutes a subject without escaping but strips newlines', () => {
    expect(renderSubject('Re: {{x}}', { x: 'a\nb' })).toBe('Re: a b');
  });

  it('extracts the unique placeholder keys used across subject and body', () => {
    expect(
      extractPlaceholders('Hi {{firstName}}', '<p>{{firstName}} {{lastName}}</p>').sort(),
    ).toEqual(['firstName', 'lastName']);
  });

  it('derives default values from the student record and course attendance totals', () => {
    expect(studentPlaceholderValues(student, 'Period 1', { tardies: 3, absences: 1 })).toEqual({
      firstName: 'Alex',
      lastName: 'Ng',
      goesBy: 'Al',
      pronouns: 'they/them',
      courseName: 'Period 1',
      lateCount: '3',
      unexcusedAbsences: '1',
    });
  });

  it('defaults attendance totals to zero when none are provided', () => {
    const v = studentPlaceholderValues(student, 'Period 1');
    expect(v.lateCount).toBe('0');
    expect(v.unexcusedAbsences).toBe('0');
  });
});
