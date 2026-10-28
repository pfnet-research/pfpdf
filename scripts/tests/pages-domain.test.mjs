import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../site/scripts/write-pages-domain.mjs', import.meta.url));

for (const siteUrl of ['https://pdf.example.com/', 'https://pdf.example.com']) {
  test(`Pages output preserves the custom domain from ${siteUrl}`, (t) => {
    const output = mkdtempSync(path.join(tmpdir(), 'pfpdf-pages-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [script, output], {
      env: { ...process.env, SITE_URL: siteUrl }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(output, 'CNAME'), 'utf8'), 'pdf.example.com\n');
  });
}

for (const siteUrl of ['', 'https://example.github.io/pfpdf/']) {
  test(`Pages default hosting removes a stale custom domain (SITE_URL=${siteUrl})`, (t) => {
    const output = mkdtempSync(path.join(tmpdir(), 'pfpdf-pages-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    writeFileSync(path.join(output, 'CNAME'), 'old.example.com\n');
    const result = spawnSync(process.execPath, [script, output], {
      env: { ...process.env, SITE_URL: siteUrl, GITHUB_REPOSITORY: 'example/pfpdf' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(output, 'CNAME')), false);
  });
}
