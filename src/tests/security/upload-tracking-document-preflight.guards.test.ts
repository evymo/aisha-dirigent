import { describe, expect, it } from 'vitest';

import {
  categoryGuard,
  filenameGuard,
  inferMimeType,
  parsePreflightBody,
  resolveMimeType,
  sanitizeFilename,
  sizeGuard,
} from '../../../trash/legacy-archive/edge-functions-reference/_shared/uploadTrackingDocumentPreflightGuards';

describe('Security - upload-health-document-preflight guards', () => {
  const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ]);

  const ALLOWED_CATEGORIES = new Set(['lab_results', 'other']);

  it('sanitizes filename and truncates length', () => {
    const safe = sanitizeFilename('a/b\\c<>:"|?*😀.pdf');
    expect(safe).toMatch(/^[a-zA-Z0-9._-]+$/);

    const long = sanitizeFilename('a'.repeat(500) + '.pdf');
    expect(long.length).toBeLessThanOrEqual(150);
  });

  it('infers mime type from filename extension', () => {
    expect(inferMimeType('x.pdf')).toBe('application/pdf');
    expect(inferMimeType('x.jpg')).toBe('image/jpeg');
    expect(inferMimeType('x.jpeg')).toBe('image/jpeg');
    expect(inferMimeType('x.png')).toBe('image/png');
    expect(inferMimeType('x.webp')).toBe('image/webp');
    expect(inferMimeType('x.doc')).toBe('application/msword');
    expect(inferMimeType('x.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(inferMimeType('x.xls')).toBe('application/vnd.ms-excel');
    expect(inferMimeType('x.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(inferMimeType('x.ppt')).toBe('application/vnd.ms-powerpoint');
    expect(inferMimeType('x.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(inferMimeType('x.txt')).toBe('text/plain');
    expect(inferMimeType('x.csv')).toBe('text/csv');
    expect(inferMimeType('x.unknown')).toBeNull();
  });

  it('parses body with safe defaults', () => {
    const parsed = parsePreflightBody({ category: 'other', size: 123, filename: 'x.pdf' });
    expect(parsed.filename).toBe('x.pdf');
    expect(parsed.size).toBe(123);
    expect(parsed.category).toBe('other');

    const parsedEmpty = parsePreflightBody(null);
    expect(parsedEmpty.filename).toBe('');
    expect(Number.isNaN(parsedEmpty.size)).toBe(true);
    expect(parsedEmpty.category).toBe('other');
  });

  it('rejects missing filename', () => {
    const failure = filenameGuard({ filename: '' });
    expect(failure).toEqual({ status: 400, error: 'filename is required' });
  });

  it('rejects invalid size and oversize', () => {
    expect(sizeGuard({ size: Number.NaN, maxBytes: 10 })).toEqual({
      status: 400,
      error: 'size is required',
    });

    expect(sizeGuard({ size: 0, maxBytes: 10 })).toEqual({ status: 400, error: 'size is required' });

    expect(sizeGuard({ size: 11, maxBytes: 10 })).toEqual({ status: 413, error: 'File too large' });
  });

  it('rejects invalid category', () => {
    const failure = categoryGuard({ category: 'bad', allowedCategories: ALLOWED_CATEGORIES });
    expect(failure).toEqual({ status: 400, error: 'Invalid category' });
  });

  it('resolves mime type from provided allowed mimeType', () => {
    const result = resolveMimeType({
      filename: 'x.pdf',
      providedMimeType: 'application/pdf',
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    expect('status' in result ? result.status : 200).toBe(200);
    if (!('status' in result)) {
      expect(result.mimeType).toBe('application/pdf');
    }
  });

  it('rejects when provided mimeType is not allowlisted and cannot infer', () => {
    const result = resolveMimeType({
      filename: 'x.unknown',
      providedMimeType: 'application/x-msdownload',
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    expect(result).toEqual({ status: 400, error: 'Invalid file type' });
  });

  it('accepts when provided mimeType is not allowlisted but can infer from filename', () => {
    const result = resolveMimeType({
      filename: 'x.xlsx',
      providedMimeType: 'application/octet-stream',
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    expect('status' in result ? result.status : 200).toBe(200);
    if (!('status' in result)) {
      expect(result.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    }
  });
});
