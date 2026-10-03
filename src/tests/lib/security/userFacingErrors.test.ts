import { describe, it, expect, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

import { getUserFacingDataErrorMessage } from '@/lib/security/userFacingErrors';

describe('getUserFacingDataErrorMessage (security)', () => {
  it('duplicate / already enrolled mapuje na errors.alreadyEnrolled', () => {
    expect(getUserFacingDataErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(
      'errors.alreadyEnrolled'
    );
    expect(getUserFacingDataErrorMessage({ message: 'User is already enrolled' })).toBe('errors.alreadyEnrolled');
  });

  it('schema drift / missing migration mapuje na errors.serviceNotConfigured', () => {
    expect(getUserFacingDataErrorMessage({ status: 400, code: '42703', message: 'undefined_column' })).toBe('errors.serviceNotConfigured');
    expect(getUserFacingDataErrorMessage({ status: 400, message: 'schema cache is stale' })).toBe('errors.serviceNotConfigured');
    expect(getUserFacingDataErrorMessage({ status: 404, message: 'not found' })).toBe('errors.serviceNotConfigured');
  });

  it('401/403 mapuje na auth/perms hlášky', () => {
    expect(getUserFacingDataErrorMessage({ status: 401, message: 'unauthorized' })).toBe('errors.signInRequired');
    expect(getUserFacingDataErrorMessage({ status: 403, message: 'forbidden' })).toBe('errors.noPermission');
  });

  it('P0001 "Access denied" mapuje na errors.noPermission', () => {
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Access denied' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Access denied: admin or staff role required' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Access denied: admin role required' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Access denied: You are not assigned to this user' })).toBe('errors.noPermission');
  });

  it('P0001 "Unauthorized" mapuje na errors.noPermission', () => {
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Unauthorized: Not a partner' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Unauthorized' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'User not authorized to chat' })).toBe('errors.noPermission');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Admin or staff access required' })).toBe('errors.noPermission');
  });

  it('P0001 "Not authenticated" mapuje na errors.signInRequired', () => {
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Not authenticated' })).toBe('errors.signInRequired');
  });

  it('P0001 ostatní výjimky padají do genericError', () => {
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Maximum 100 records per sync' })).toBe('errors.genericError');
    expect(getUserFacingDataErrorMessage({ code: 'P0001', message: 'Missing required payload fields' })).toBe('errors.genericError');
  });

  it('default vrací errors.genericError', () => {
    expect(getUserFacingDataErrorMessage(new Error('something else'))).toBe('errors.genericError');
    expect(getUserFacingDataErrorMessage('plain string')).toBe('errors.genericError');
    expect(getUserFacingDataErrorMessage(null)).toBe('errors.genericError');
  });
});
