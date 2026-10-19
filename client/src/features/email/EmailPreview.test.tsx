import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailPreview } from './EmailPreview';

describe('EmailPreview', () => {
  it('renders the subject and the body inside a sandboxed iframe', () => {
    render(<EmailPreview subject="Hello Alex" bodyHtml="<p>Body text</p>" />);
    expect(screen.getByText('Hello Alex')).toBeInTheDocument();

    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
    // Sandboxed (empty sandbox disables scripts) and content passed via srcDoc.
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('<p>Body text</p>');
  });

  it('shows a placeholder when the subject is empty', () => {
    render(<EmailPreview subject="" bodyHtml="<p>x</p>" />);
    expect(screen.getByText('(no subject)')).toBeInTheDocument();
  });
});
