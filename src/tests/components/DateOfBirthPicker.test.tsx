import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DateOfBirthPicker } from '@/components/ui/date-of-birth-picker';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('DateOfBirthPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render three select elements', () => {
    const onChange = vi.fn();
    render(<DateOfBirthPicker value={undefined} onChange={onChange} />);
    
    expect(screen.getByTestId('dob-day')).toBeInTheDocument();
    expect(screen.getByTestId('dob-month')).toBeInTheDocument();
    expect(screen.getByTestId('dob-year')).toBeInTheDocument();
  });

  it('should call onChange when all fields are set', () => {
    const onChange = vi.fn();
    
    render(<DateOfBirthPicker value={undefined} onChange={onChange} />);
    
    const daySelect = screen.getByTestId('dob-day');
    const monthSelect = screen.getByTestId('dob-month');
    const yearSelect = screen.getByTestId('dob-year');
    
    // Set day - should not call onChange yet
    fireEvent.change(daySelect, { target: { value: '15' } });
    expect(onChange).not.toHaveBeenCalled();
    
    // Set month - should not call onChange yet
    fireEvent.change(monthSelect, { target: { value: '1' } });
    expect(onChange).not.toHaveBeenCalled();
    
    // Set year - now should call onChange with complete date
    fireEvent.change(yearSelect, { target: { value: '2000' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    
    const date = onChange.mock.calls[0][0];
    expect(date).toBeInstanceOf(Date);
    expect(date.getDate()).toBe(15);
    expect(date.getMonth()).toBe(0); // January = 0
    expect(date.getFullYear()).toBe(2000);
  });

  it('should display current value', () => {
    const onChange = vi.fn();
    const testDate = new Date(1990, 5, 20); // June 20, 1990
    
    render(<DateOfBirthPicker value={testDate} onChange={onChange} />);
    
    const daySelect = screen.getByTestId('dob-day') as HTMLSelectElement;
    const monthSelect = screen.getByTestId('dob-month') as HTMLSelectElement;
    const yearSelect = screen.getByTestId('dob-year') as HTMLSelectElement;
    
    expect(daySelect.value).toBe('20');
    expect(monthSelect.value).toBe('6'); // June = 6 (1-indexed in component)
    expect(yearSelect.value).toBe('1990');
  });
});
