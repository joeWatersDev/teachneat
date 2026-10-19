import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelpPage } from './HelpPage';

describe('HelpPage', () => {
  it('offers the contact form and the four things there are to read', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/support', '/help/your-data', '/faq', '/privacy', '/terms']);
  });

  // Two groups, not one list of five. Contacting us is the only row on the page
  // that starts something, and a row that creates a support request should not
  // sit in a list of documents where it can be clicked by momentum.
  it('separates the things to read under their own heading', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Reference' })).toBeInTheDocument();
  });

  // Documentation with a task behind it — export a class list, delete an
  // account — rather than an agreement that is consulted. It leads the group.
  it('leads the reference group with the data documentation', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links[1]).toHaveAttribute('href', '/help/your-data');
  });

});
