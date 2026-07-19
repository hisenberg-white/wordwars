import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Overlay } from './Overlay';

afterEach(cleanup);

/**
 * Found by actually opening the app: the sign-in dialog rendered underneath
 * the interface.
 *
 * `TopNav` is `sticky z-40 backdrop-blur-md` and renders the account chip, so
 * a dialog returned from inside it inherited two CSS traps at once — the
 * backdrop filter made the header the containing block for `position: fixed`,
 * and the sticky z-index trapped the dialog's own stacking order inside the
 * header. No amount of z-index fixes that from the inside; the dialog has to
 * leave the subtree.
 */
describe('escaping its parent', () => {
  it('renders into document.body, not where it was declared', () => {
    const { container } = render(
      <div id="trapped" style={{ backdropFilter: 'blur(4px)', position: 'sticky', zIndex: 40 }}>
        <Overlay onClose={vi.fn()} label="Sign in">
          <p>panel</p>
        </Overlay>
      </div>,
    );

    // Nothing left behind in the ancestor that would have trapped it.
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // And it IS in the document, mounted at the top level.
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
  });

  it('is labelled and marked modal for assistive tech', () => {
    render(
      <Overlay onClose={vi.fn()} label="Change your name">
        <p>panel</p>
      </Overlay>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change your name' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});

describe('dismissing', () => {
  it('closes on a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Overlay onClose={onClose} label="Sign in">
        <p>panel</p>
      </Overlay>,
    );

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** Clicking the form you are filling in must not throw you out of it. */
  it('does not close when the click came from inside', () => {
    const onClose = vi.fn();
    render(
      <Overlay onClose={onClose} label="Sign in">
        <button type="button">submit</button>
      </Overlay>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  /** The only way out for someone navigating by keyboard. */
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Overlay onClose={onClose} label="Sign in">
        <p>panel</p>
      </Overlay>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores both when not dismissible', () => {
    const onClose = vi.fn();
    render(
      <Overlay onClose={onClose} label="Countdown" dismissible={false}>
        <p>3</p>
      </Overlay>,
    );

    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the page behind it', () => {
  it('stops scrolling while open and is restored after', () => {
    const { unmount } = render(
      <Overlay onClose={vi.fn()} label="Sign in">
        <p>panel</p>
      </Overlay>,
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
