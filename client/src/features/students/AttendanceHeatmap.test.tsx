import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AttendanceHeatmap } from './AttendanceHeatmap';
import * as attendanceApi from '../../api/attendance';
import { todayIso } from '../attendance/dates';
import type { AttendanceRecord } from '../attendance/types';

vi.mock('../../api/attendance');

describe('AttendanceHeatmap', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function record(over: Partial<AttendanceRecord>): AttendanceRecord {
    return {
      id: 'r1',
      studentId: 's1',
      course: 'Period 1',
      date: todayIso(),
      statusKey: 'a',
      notes: null,
      ...over,
    };
  }

  it('renders the legend and a range readout when the student has records', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([record({})]);
    render(<AttendanceHeatmap studentId="s1" />);

    await waitFor(() => expect(screen.getByText('Present')).toBeInTheDocument());
    expect(screen.getByText('Absent')).toBeInTheDocument();
    expect(screen.getByText('Excused')).toBeInTheDocument();
    expect(screen.getByText('No record')).toBeInTheDocument();
    // The default readout shows the visible date range (contains an en dash).
    expect(screen.getByRole('status')).toHaveTextContent('–');
  });

  // It has its own subheading now, so an empty grid has to say so rather than
  // render nothing and leave a bare heading. The wording differs from the
  // summary's, which sits beside it and would otherwise repeat the sentence.
  it('says there is no history when the student has no records', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
    render(<AttendanceHeatmap studentId="s1" />);

    await waitFor(() => expect(screen.queryByText('Loading history…')).not.toBeInTheDocument());
    expect(screen.queryByText('Present')).not.toBeInTheDocument();
    expect(screen.getByText('No history to show yet.')).toBeInTheDocument();
  });

  it('ignores other students’ records', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([
      record({ id: 'r2', studentId: 'other', statusKey: 'a' }),
    ]);
    render(<AttendanceHeatmap studentId="s1" />);

    await waitFor(() => expect(screen.queryByText('Loading history…')).not.toBeInTheDocument());
    // No records for s1 -> the empty state, not another student's grid.
    expect(screen.getByText('No history to show yet.')).toBeInTheDocument();
  });
});
