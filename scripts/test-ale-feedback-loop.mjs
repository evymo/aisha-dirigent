#!/usr/bin/env node

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    force: { type: 'boolean', default: false },
    'has-correction': { type: 'boolean', default: false },
    limit: { type: 'string', default: '50' },
    'min-batch-size': { type: 'string', default: '3' },
    'min-rating': { type: 'string', default: '4' },
    'n8n-url': { type: 'string', default: process.env.N8N_URL || 'http://127.0.0.1:5678' },
    'org-id': { type: 'string' },
    'pending-count': { type: 'string', default: '1' },
    rating: { type: 'string', default: '5' },
    'story-id': { type: 'string' },
  },
});

const payload = {
  force: values.force,
  has_correction: values['has-correction'],
  limit: Number(values.limit),
  min_batch_size: Number(values['min-batch-size']),
  min_rating: Number(values['min-rating']),
  org_id: values['org-id'] || null,
  pending_count: Number(values['pending-count']),
  rating: Number(values.rating),
  source: 'manual_simulation',
  story_id: values['story-id'] || null,
};

const url = `${values['n8n-url'].replace(/\/$/, '')}/webhook/ale-feedback-process`;

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(10_000),
});

const text = await response.text();
console.log(`POST ${url}`);
console.log(`Status: ${response.status}`);

try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}