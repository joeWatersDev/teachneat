import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';
import { Input } from './Input';

/**
 * The regression this file exists for (found in Step 6f).
 *
 * `Modal` focused its panel from the same effect that registered the Escape
 * listener, keyed on `onClose`. A caller that passes an inline arrow — which is
 * most of them — gets a new `onClose` identity on every render, so any caller
 * whose modal held a text field *and* the state behind it re-ran that effect on
 * every keystroke and pulled focus back to the panel. Exactly one character ever
 * landed.
 *
 * It stayed hidden because the modals that came first kept their field state in
 * a child component, so the parent did not re-render as you typed. That makes it
 * the kind of bug that reappears the moment someone writes the ordinary thing,
 * which is why the assertion is here on the primitive rather than on the page
 * that happened to surface it.
 */
function TypingModal() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    // The shape that broke: an inline handler, and the field's state living in
    // the same component that renders the modal.
    <Modal title="Confirm" onClose={() => setOpen(false)}>
      <Input label="Type it" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  );
}

describe('Modal', () => {
  it('lets a field inside it be typed into more than one character', async () => {
    render(<TypingModal />);
    const field = screen.getByLabelText('Type it');
    await userEvent.type(field, 'Delete');
    expect(field).toHaveValue('Delete');
  });

  it('still focuses the panel when it opens', () => {
    render(<TypingModal />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('still closes on Escape', async () => {
    render(<TypingModal />);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
