import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplatesView } from './TemplatesView';
import * as emailApi from '../../api/email';
import type { EmailTemplate } from './types';

vi.mock('../../api/email');

const template: EmailTemplate = {
  id: 't1',
  name: 'Absence notice',
  subject: 'About your student',
  bodyHtml: '<p>Hi</p>',
  placeholdersUsed: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('TemplatesView', () => {
  it('shows an empty state when there are no templates', () => {
    render(<TemplatesView templates={[]} loading={false} error={null} onChanged={vi.fn()} />);
    expect(screen.getByText('No templates yet')).toBeInTheDocument();
  });

  it('lists templates with their subject', () => {
    render(
      <TemplatesView templates={[template]} loading={false} error={null} onChanged={vi.fn()} />,
    );
    expect(screen.getByText('Absence notice')).toBeInTheDocument();
    expect(screen.getByText('About your student')).toBeInTheDocument();
  });

  it('confirms and deletes a template', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(emailApi.deleteTemplate).mockResolvedValue(undefined);

    render(
      <TemplatesView templates={[template]} loading={false} error={null} onChanged={onChanged} />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete Absence notice' }));
    expect(screen.getByRole('dialog', { name: 'Delete template' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Template' }));
    await waitFor(() => expect(emailApi.deleteTemplate).toHaveBeenCalledWith('t1'));
    expect(onChanged).toHaveBeenCalled();
  });
});
