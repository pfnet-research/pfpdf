import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RELEASE_PDF_NAMES = Object.freeze([
  'design.en.pdf',
  'design.ja.pdf',
  'tutorial.en.pdf',
  'tutorial.ja.pdf',
]);

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const REQUIRED_PACKED_FILES = Object.freeze([
  'LICENSE',
  'README.ja.md',
  'README.md',
  'SECURITY.md',
  'THIRD_PARTY_LICENSES.md',
  'dist/launcher.js',
  'npm-shrinkwrap.json',
  'package.json',
  'resources/templates/manifest.json',
]);
const FORBIDDEN_PACKED_PREFIXES = Object.freeze([
  '.env',
  '.git/',
  '.github/',
  'build/',
  'docs/',
  'node_modules/',
  'package-lock.json',
  'scripts/',
  'src/',
]);
const VERIFICATION_MARKER = '<!-- pfpdf-release-verification -->';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseVersion(version) {
  const match = SEMVER_RE.exec(version);
  invariant(match !== null, `invalid SemVer version: ${version}`);
  return {
    version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

export function validateReleaseSource({ root, tag, sha = null }) {
  const packageJson = readJson(path.join(root, 'package.json'));
  const parsed = parseVersion(packageJson.version);
  invariant(tag === `v${parsed.version}`, `tag ${tag} does not match package version ${parsed.version}`);
  if (sha !== null) {
    invariant(/^[0-9a-f]{40}$/.test(sha), `invalid source commit SHA: ${sha}`);
  }

  const packageLockPath = path.join(root, 'package-lock.json');
  const shrinkwrapPath = path.join(root, 'npm-shrinkwrap.json');
  const packageLockBytes = fs.readFileSync(packageLockPath);
  const shrinkwrapBytes = fs.readFileSync(shrinkwrapPath);
  invariant(packageLockBytes.equals(shrinkwrapBytes), 'package-lock.json and npm-shrinkwrap.json differ');

  const lock = JSON.parse(packageLockBytes.toString('utf8'));
  invariant(lock.version === parsed.version, 'package-lock.json top-level version does not match package.json');
  invariant(lock.packages?.['']?.version === parsed.version, 'package-lock.json root package version does not match package.json');
  invariant(lock.name === packageJson.name, 'package-lock.json package name does not match package.json');

  const changelogPath = path.join(root, 'CHANGELOG.md');
  invariant(fs.existsSync(changelogPath), 'CHANGELOG.md is required');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const heading = new RegExp(`^## \\[?${escapeRegExp(parsed.version)}(?:\\]|\\s|$)`, 'm');
  invariant(heading.test(changelog), `CHANGELOG.md has no entry for ${parsed.version}`);

  return {
    name: packageJson.name,
    version: parsed.version,
    tag,
    sha,
    prerelease: parsed.prerelease !== null,
  };
}

export function inspectNpmPack({ packJsonPath, expectedName, expectedVersion }) {
  const report = readJson(packJsonPath);
  invariant(Array.isArray(report) && report.length === 1, 'npm pack report must contain exactly one package');
  const packed = report[0];
  invariant(packed && typeof packed === 'object', 'npm pack report entry is missing');
  invariant(packed.name === expectedName, `packed package name is ${packed.name}, expected ${expectedName}`);
  invariant(packed.version === expectedVersion, `packed version is ${packed.version}, expected ${expectedVersion}`);
  invariant(typeof packed.filename === 'string' && packed.filename.endsWith('.tgz'), 'npm pack report has no tarball filename');
  invariant(!packed.filename.includes('/') && !packed.filename.includes('\\'), 'npm tarball filename must be a basename');
  invariant(typeof packed.shasum === 'string' && /^[0-9a-f]{40}$/.test(packed.shasum), 'npm pack report has an invalid SHA-1');
  invariant(typeof packed.integrity === 'string' && packed.integrity.startsWith('sha512-'), 'npm pack report has no SHA-512 integrity');
  invariant(Array.isArray(packed.files), 'npm pack report has no file list');

  const names = packed.files.map((entry) => entry.path).sort();
  invariant(new Set(names).size === names.length, 'npm tarball contains duplicate paths');
  for (const required of REQUIRED_PACKED_FILES) {
    invariant(names.includes(required), `npm tarball is missing ${required}`);
  }
  for (const name of names) {
    invariant(typeof name === 'string' && name !== '', 'npm tarball contains an invalid path');
    invariant(!name.startsWith('/') && !name.split('/').includes('..'), `npm tarball contains an unsafe path: ${name}`);
    invariant(!name.endsWith('.map'), `npm tarball contains a source map: ${name}`);
    for (const forbidden of FORBIDDEN_PACKED_PREFIXES) {
      invariant(name !== forbidden && !name.startsWith(forbidden), `npm tarball contains forbidden path: ${name}`);
    }
  }

  return packed;
}

function releaseArtifactPaths(metadataPath, metadata) {
  const releaseDir = path.dirname(metadataPath);
  return {
    tarball: path.join(releaseDir, metadata.npm.filename),
    pdfs: metadata.pdfs.map((pdf) => path.join(releaseDir, 'pdfs', pdf.name)),
    checksums: path.join(releaseDir, 'SHA256SUMS'),
  };
}

export function createReleaseArtifacts({
  root,
  tag,
  sha,
  packJsonPath,
  pdfDir,
  browserVersion,
  outputPath,
  checksumsPath,
}) {
  const source = validateReleaseSource({ root, tag, sha });
  const packageJson = readJson(path.join(root, 'package.json'));
  const packed = inspectNpmPack({
    packJsonPath,
    expectedName: source.name,
    expectedVersion: source.version,
  });
  const tarballPath = path.join(path.dirname(packJsonPath), packed.filename);
  invariant(fs.existsSync(tarballPath), `npm tarball does not exist: ${tarballPath}`);

  const actualPdfNames = fs.readdirSync(pdfDir).filter((name) => name.endsWith('.pdf')).sort();
  invariant(
    JSON.stringify(actualPdfNames) === JSON.stringify(RELEASE_PDF_NAMES),
    `release PDF set is invalid: ${actualPdfNames.join(', ')}`,
  );
  const pdfs = RELEASE_PDF_NAMES.map((name) => {
    const file = path.join(pdfDir, name);
    return { name, sha256: sha256File(file), size: fs.statSync(file).size };
  });

  const fontPackages = Object.fromEntries(
    Object.entries(packageJson.devDependencies ?? {})
      .filter(([name]) => name.startsWith('@fontsource/'))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const metadata = {
    schemaVersion: 1,
    source: { tag, commit: sha },
    npm: {
      name: source.name,
      version: source.version,
      prerelease: source.prerelease,
      filename: packed.filename,
      shasum: packed.shasum,
      integrity: packed.integrity,
      sha256: sha256File(tarballPath),
      size: fs.statSync(tarballPath).size,
      unpackedSize: packed.unpackedSize,
      fileCount: packed.files.length,
    },
    pdfs,
    toolchain: {
      node: process.version,
      vivliostyle: packageJson.dependencies?.['@vivliostyle/cli'] ?? null,
      chromium: browserVersion.trim(),
      fonts: fontPackages,
    },
  };

  writeJson(outputPath, metadata);
  fs.writeFileSync(checksumsPath, `${pdfs.map((pdf) => `${pdf.sha256}  ${pdf.name}`).join('\n')}\n`);
  verifyReleaseArtifacts({ metadataPath: outputPath });
  return metadata;
}

export function verifyReleaseArtifacts({ metadataPath }) {
  const metadata = readJson(metadataPath);
  invariant(metadata.schemaVersion === 1, 'unsupported release metadata schema');
  validateReleaseMetadata(metadata);
  const paths = releaseArtifactPaths(metadataPath, metadata);
  invariant(fs.existsSync(paths.tarball), `release tarball is missing: ${paths.tarball}`);
  invariant(sha256File(paths.tarball) === metadata.npm.sha256, 'release tarball SHA-256 mismatch');
  for (const [index, pdf] of metadata.pdfs.entries()) {
    const file = paths.pdfs[index];
    invariant(fs.existsSync(file), `release PDF is missing: ${pdf.name}`);
    invariant(sha256File(file) === pdf.sha256, `release PDF SHA-256 mismatch: ${pdf.name}`);
  }
  const expectedChecksums = `${metadata.pdfs.map((pdf) => `${pdf.sha256}  ${pdf.name}`).join('\n')}\n`;
  invariant(fs.readFileSync(paths.checksums, 'utf8') === expectedChecksums, 'SHA256SUMS does not match release PDFs');
  return metadata;
}

function validateReleaseMetadata(metadata) {
  const parsed = parseVersion(metadata.npm?.version);
  invariant(metadata.source?.tag === `v${parsed.version}`, 'release metadata tag/version mismatch');
  invariant(/^[0-9a-f]{40}$/.test(metadata.source?.commit ?? ''), 'release metadata has an invalid commit SHA');
  invariant(typeof metadata.npm?.name === 'string' && metadata.npm.name !== '', 'release metadata has no package name');
  invariant(metadata.npm.prerelease === (parsed.prerelease !== null), 'release metadata prerelease flag mismatch');
  invariant(/^[0-9a-f]{40}$/.test(metadata.npm.shasum ?? ''), 'release metadata has an invalid npm SHA-1');
  invariant(typeof metadata.npm.integrity === 'string' && metadata.npm.integrity.startsWith('sha512-'), 'release metadata has invalid npm integrity');
  invariant(/^[0-9a-f]{64}$/.test(metadata.npm.sha256 ?? ''), 'release metadata has an invalid npm SHA-256');
  invariant(
    JSON.stringify(metadata.pdfs?.map((pdf) => pdf.name)) === JSON.stringify(RELEASE_PDF_NAMES),
    'release metadata has an invalid PDF set',
  );
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${executable} ${args.join(' ')} failed with status ${result.status}${output ? `\n${output}` : ''}`);
  }
  return result;
}

function npmCliPath() {
  const executableDir = path.dirname(process.execPath);
  const candidates = process.platform === 'win32'
    ? [
        path.join(executableDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.resolve(executableDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
    : [
        path.resolve(executableDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(executableDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runNpm(args, options = {}) {
  const npmCli = npmCliPath();
  if (npmCli !== null) return run(process.execPath, [npmCli, ...args], options);
  invariant(process.platform !== 'win32', 'cannot locate npm-cli.js on Windows');
  return run('npm', args, options);
}

export function testPackedPackage({ metadataPath }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  const { tarball } = releaseArtifactPaths(metadataPath, metadata);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-packed-'));
  try {
    fs.writeFileSync(path.join(temp, 'package.json'), '{"private":true}\n');
    runNpm([
      'install', '--no-audit', '--no-fund', '--no-package-lock', tarball,
    ], { cwd: temp });
    runNpm(['ls', '--all', '--json'], { cwd: temp });

    const bin = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'pfpdf.cmd' : 'pfpdf');
    invariant(fs.existsSync(bin), 'packed package did not install the pfpdf executable');
    const launcher = path.join(temp, 'node_modules', ...metadata.npm.name.split('/'), 'dist', 'launcher.js');
    invariant(fs.existsSync(launcher), 'packed package did not install dist/launcher.js');
    const version = run(process.execPath, [launcher, '--version'], { cwd: temp });
    invariant(version.stdout.trim() === metadata.npm.version, 'packed executable reports the wrong version');

    const input = path.join(temp, 'input.md');
    const output = path.join(temp, 'output.pdf');
    fs.writeFileSync(input, '---\ntitle: Packed package smoke test\n---\n\n# Test\n\nHello from pfpdf.\n');
    run(process.execPath, [launcher, '--input', input, '--output', output], {
      cwd: temp,
      env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' },
    });
    const pdf = fs.readFileSync(output);
    invariant(pdf.subarray(0, 5).toString('ascii') === '%PDF-', 'packed package did not produce a PDF');
    return { platform: process.platform, arch: process.arch, version: metadata.npm.version, pdfBytes: pdf.length };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function npmView(metadata) {
  const spec = `${metadata.npm.name}@${metadata.npm.version}`;
  const result = runNpm([
    'view', spec, 'version', 'dist.shasum', 'dist.integrity', '--json',
  ], { allowFailure: true });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (/E404|404 Not Found|is not in this registry/i.test(output)) return null;
    throw new Error(`cannot query npm registry for ${spec}\n${output.trim()}`);
  }
  const value = JSON.parse(result.stdout);
  return {
    version: value.version,
    shasum: value['dist.shasum'],
    integrity: value['dist.integrity'],
  };
}

export function registryStatus({ metadataPath }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  const published = npmView(metadata);
  if (published === null) return { published: false, matches: null };
  const matches = published.version === metadata.npm.version
    && published.shasum === metadata.npm.shasum
    && published.integrity === metadata.npm.integrity;
  invariant(matches, `npm already contains different bytes for ${metadata.npm.name}@${metadata.npm.version}`);
  return { published: true, matches: true };
}

export function writeReleaseSummary({ metadataPath, outputPath }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  const pdfRows = metadata.pdfs
    .map((pdf) => `| \`${pdf.name}\` | \`${pdf.sha256}\` | ${pdf.size} |`)
    .join('\n');
  const summary = `## Release candidate ${metadata.source.tag}\n\n`
    + `- Source: \`${metadata.source.commit}\`\n`
    + `- npm: \`${metadata.npm.name}@${metadata.npm.version}\`\n`
    + `- npm tarball SHA-256: \`${metadata.npm.sha256}\`\n`
    + `- npm files: ${metadata.npm.fileCount}\n`
    + `- Vivliostyle CLI: \`${metadata.toolchain.vivliostyle}\`\n`
    + `- Chromium: \`${metadata.toolchain.chromium}\`\n\n`
    + '| PDF | SHA-256 | bytes |\n|---|---|---:|\n'
    + `${pdfRows}\n\n`;
  fs.appendFileSync(outputPath, summary);
  return { tag: metadata.source.tag, output: outputPath };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyPublishedPackage({ metadataPath, attempts = 18, delayMs = 10_000 }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  let status = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    status = registryStatus({ metadataPath });
    if (status.published) break;
    if (attempt < attempts) await sleep(delayMs);
  }
  invariant(status?.published === true, `npm package did not become visible after ${attempts} attempts`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-published-'));
  try {
    fs.writeFileSync(path.join(temp, 'package.json'), '{"private":true}\n');
    const spec = `${metadata.npm.name}@${metadata.npm.version}`;
    const version = runNpm([
      'exec', '--yes', `--package=${spec}`, '--', 'pfpdf', '--version',
    ], { cwd: temp });
    invariant(version.stdout.trim() === metadata.npm.version, 'published executable reports the wrong version');

    const input = path.join(temp, 'input.md');
    const output = path.join(temp, 'output.pdf');
    fs.writeFileSync(input, '---\ntitle: Registry smoke test\n---\n\n# Test\n\nInstalled from the public npm registry.\n');
    runNpm([
      'exec', '--yes', `--package=${spec}`, '--', 'pfpdf', '--input', input, '--output', output,
    ], { cwd: temp, env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' } });
    const pdf = fs.readFileSync(output);
    invariant(pdf.subarray(0, 5).toString('ascii') === '%PDF-', 'published package did not produce a PDF');
    return { package: spec, version: metadata.npm.version, pdfBytes: pdf.length };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function ghReleaseView(tag) {
  const result = run('gh', [
    'release', 'view', tag, '--json', 'assets,body,isDraft,targetCommitish,url',
  ]);
  return JSON.parse(result.stdout);
}

export function stageGitHubRelease({ metadataPath }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  const release = ghReleaseView(metadata.source.tag);
  invariant(release.isDraft === true, `GitHub Release ${metadata.source.tag} is not a draft`);
  const expectedNames = [...RELEASE_PDF_NAMES, 'SHA256SUMS'].sort();
  const existingNames = release.assets.map((asset) => asset.name).sort();
  for (const name of existingNames) {
    invariant(expectedNames.includes(name), `draft GitHub Release contains unexpected asset: ${name}`);
  }

  const paths = releaseArtifactPaths(metadataPath, metadata);
  run('gh', [
    'release', 'upload', metadata.source.tag, ...paths.pdfs, paths.checksums, '--clobber',
  ]);
  const staged = ghReleaseView(metadata.source.tag);
  const stagedNames = staged.assets.map((asset) => asset.name).sort();
  invariant(JSON.stringify(stagedNames) === JSON.stringify(expectedNames), 'draft GitHub Release asset set is incomplete');
  return { tag: metadata.source.tag, url: staged.url, assets: stagedNames };
}

function releaseVerificationNotes(metadata) {
  const fontVersions = [...new Set(Object.values(metadata.toolchain.fonts))].join(', ');
  const pdfLines = metadata.pdfs.map((pdf) => `- \`${pdf.name}\`: \`${pdf.sha256}\``).join('\n');
  return `${VERIFICATION_MARKER}\n## Release verification\n\n`
    + `- Source commit: \`${metadata.source.commit}\`\n`
    + `- npm package: \`${metadata.npm.name}@${metadata.npm.version}\` (public registry smoke test passed)\n`
    + `- npm tarball SHA-256: \`${metadata.npm.sha256}\`\n`
    + `- Build Node.js: \`${metadata.toolchain.node}\`\n`
    + `- Vivliostyle CLI: \`${metadata.toolchain.vivliostyle}\`\n`
    + `- Chromium: \`${metadata.toolchain.chromium}\`\n`
    + `- Bundled font package versions: \`${fontVersions}\`\n\n`
    + `### PDF SHA-256\n\n${pdfLines}\n`;
}

export function finalizeGitHubRelease({ metadataPath }) {
  const metadata = verifyReleaseArtifacts({ metadataPath });
  const release = ghReleaseView(metadata.source.tag);
  invariant(release.isDraft === true, `GitHub Release ${metadata.source.tag} is already published`);
  const body = typeof release.body === 'string' ? release.body : '';
  const baseBody = body.includes(VERIFICATION_MARKER)
    ? body.slice(0, body.indexOf(VERIFICATION_MARKER)).trimEnd()
    : body.trimEnd();
  const notes = `${baseBody}\n\n${releaseVerificationNotes(metadata)}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-release-notes-'));
  try {
    const notesFile = path.join(temp, 'notes.md');
    fs.writeFileSync(notesFile, notes);
    const args = [
      'release', 'edit', metadata.source.tag, '--notes-file', notesFile, '--draft=false',
    ];
    if (metadata.npm.prerelease) {
      args.push('--prerelease');
    } else {
      args.push('--prerelease=false', '--latest');
    }
    run('gh', args);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return { tag: metadata.source.tag, url: release.url, published: true };
}
