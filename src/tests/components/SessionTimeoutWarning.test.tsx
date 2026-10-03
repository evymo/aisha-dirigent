import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      // Handle interpolation: t('key', { time: '1:05' }) -> 'key (time: 1:05)'
      if (typeof options === 'object' && options !== null) {
        const vars = Object.entries(options)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return `${key} (${vars})`;
      }
      return typeof options === 'string' ? options : key;
    },
  }),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div data-testid="dialog">{children}</div> : null),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => <h1>{children}</h1>,
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { SessionTimeoutWarning } from '@/components/session/SessionTimeoutWarning';

describe('SessionTimeoutWarning', () => {
  it('renders countdown and triggers callbacks', async () => {
    const onExtend = vi.fn();
    const onLogout = vi.fn();

    renderWithProviders(
      <SessionTimeoutWarning
        open={true}
        remainingSeconds={65}
        onExtend={onExtend}
        onLogout={onLogout}
      />
    );

    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    // Check for interpolated time text: "session.time_remaining (time: 1:05)"
    expect(screen.getByText(/session\.time_remaining.*1:05/)).toBeInTheDocument();

    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'session.logout_now' }));
    expect(onLogout).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'session.stay_logged_in' }));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    renderWithProviders(
      <SessionTimeoutWarning
        open={false}
        remainingSeconds={1}
        onExtend={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });
});
