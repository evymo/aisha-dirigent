import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/test-utils';
import { NavLink } from '@/components/NavLink';

describe('NavLink', () => {
  it('applies activeClassName when route is active', () => {
    renderWithProviders(
      <NavLink to="/target" className="base" activeClassName="active">
        Target
      </NavLink>,
      { initialEntries: ['/target'] },
    );

    const link = screen.getByRole('link', { name: 'Target' });
    expect(link).toHaveClass('base');
    expect(link).toHaveClass('active');
  });

  it('does not apply activeClassName when route is inactive', () => {
    renderWithProviders(
      <NavLink to="/target" className="base" activeClassName="active">
        Target
      </NavLink>,
      { initialEntries: ['/other'] },
    );

    const link = screen.getByRole('link', { name: 'Target' });
    expect(link).toHaveClass('base');
    expect(link).not.toHaveClass('active');
  });
});
