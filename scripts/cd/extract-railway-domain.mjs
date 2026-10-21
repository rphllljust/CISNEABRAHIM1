#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('Usage: extract-railway-domain.mjs <json-file>');
const text = readFileSync(path, 'utf8');
const parsed = JSON.parse(text);

function find(value) {
  if (typeof value === 'string') {
    const normalized = value.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return normalized.endsWith('.up.railway.app') ? normalized : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = find(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const hit = find(item);
      if (hit) return hit;
    }
  }
  return null;
}

const domain = find(parsed);
if (!domain) throw new Error('No Railway service domain found in CLI response');
process.stdout.write(`https://${domain}`);
