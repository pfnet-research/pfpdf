import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RELEASE_PDF_NAMES,
  createReleaseArtifacts,
  inspectNpmPack,
  parseVersion,
  validateReleaseSource,
  verifyReleaseArtifacts,
} from '../release-lib.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-release-test-'));
  const pkg = {
    name: '@example/pfpdf',
    version: '1.2.3',
    dependencies: { '@vivliostyle/cli': '11.1.0' },
    devDependencies: { '@fontsource/noto-sans': '5.3.0' },
  };
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: { '': { name: pkg.name, version: pkg.version } },
  };
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'package-lock.json'), lockBytes);
  fs.writeFileSync(path.join(root, 'npm-shrinkwrap.json'), lockBytes);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3](example) (2026-08-18)\n');
  return root;
}

function packReport(root) {
  const required = [
    'LICENSE',
    'README.ja.md',
    'README.md',
    'SECURITY.md',
    'THIRD_PARTY_LICENSES.md',
    'dist/launcher.js',
    'npm-shrinkwrap.json',
    'package.json',
    'resources/templates/manifest.json',
  ];
  const tarball = path.join(root, 'example-pfpdf-1.2.3.tgz');
  fs.writeFileSync(tarball, 'tarball fixture');
  const report = [{
    name: '@example/pfpdf',
    version: '1.2.3',
    filename: path.basename(tarball),
    shasum: 'a'.repeat(40),
    integrity: 'sha512-fixture',
    unpackedSize: 1234,
    files: required.map((file) => ({ path: file, size: 1 })),
  }];
  const reportPath = path.join(root, 'npm-pack.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
  return reportPath;
}

test('strict SemVer parsing distinguishes prereleases', () => {
  assert.equal(parseVersion('1.2.3').prerelease, null);
  assert.equal(parseVersion('1.2.3-beta.1').prerelease, 'beta.1');
  assert.throws(() => parseVersion('01.2.3'), /invalid SemVer/);
});

test('release source requires matching tag, changelog, and locks', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = validateReleaseSource({ root, tag: 'v1.2.3', sha: 'a'.repeat(40) });
  assert.equal(result.version, '1.2.3');
  assert.throws(() => validateReleaseSource({ root, tag: 'v1.2.4' }), /does not match/);
  fs.appendFileSync(path.join(root, 'npm-shrinkwrap.json'), ' ');
  assert.throws(() => validateReleaseSource({ root, tag: 'v1.2.3' }), /differ/);
});

test('npm pack inspection enforces the publication allowlist', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reportPath = packReport(root);
  const packed = inspectNpmPack({
    packJsonPath: reportPath,
    expectedName: '@example/pfpdf',
    expectedVersion: '1.2.3',
  });
  assert.equal(packed.filename, 'example-pfpdf-1.2.3.tgz');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report[0].files.push({ path: 'src/private.ts', size: 1 });
  fs.writeFileSync(reportPath, JSON.stringify(report));
  assert.throws(() => inspectNpmPack({
    packJsonPath: reportPath,
    expectedName: '@example/pfpdf',
    expectedVersion: '1.2.3',
  }), /forbidden path/);
});

test('release artifact metadata covers the exact PDF set and detects changes', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reportPath = packReport(root);
  const pdfDir = path.join(root, 'pdfs');
  fs.mkdirSync(pdfDir);
  for (const name of RELEASE_PDF_NAMES) fs.writeFileSync(path.join(pdfDir, name), `%PDF-${name}`);
  const metadataPath = path.join(root, 'release-metadata.json');
  const checksumsPath = path.join(root, 'SHA256SUMS');
  const metadata = createReleaseArtifacts({
    root,
    tag: 'v1.2.3',
    sha: 'b'.repeat(40),
    packJsonPath: reportPath,
    pdfDir,
    browserVersion: 'Chromium fixture',
    outputPath: metadataPath,
    checksumsPath,
  });
  assert.deepEqual(metadata.pdfs.map((pdf) => pdf.name), RELEASE_PDF_NAMES);
  verifyReleaseArtifacts({ metadataPath });
  fs.appendFileSync(path.join(pdfDir, RELEASE_PDF_NAMES[0]), 'changed');
  assert.throws(() => verifyReleaseArtifacts({ metadataPath }), /SHA-256 mismatch/);
});
