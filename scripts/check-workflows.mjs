import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, '.github', 'workflows');
let failed = false;

function error(message) {
  process.stderr.write(`${message}\n`);
  failed = true;
}

function visit(value, file) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, file);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.uses === 'string' && !value.uses.startsWith('./')) {
    const at = value.uses.lastIndexOf('@');
    const revision = at === -1 ? '' : value.uses.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      error(`${file}: action is not pinned to a full commit SHA: ${value.uses}`);
    }
  }
  for (const child of Object.values(value)) visit(child, file);
}

for (const name of fs.readdirSync(workflowDir).filter((file) => file.endsWith('.yml')).sort()) {
  const file = path.join(workflowDir, name);
  const source = fs.readFileSync(file, 'utf8');
  let workflow;
  try {
    workflow = yaml.load(source);
  } catch (cause) {
    error(`${name}: invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`);
    continue;
  }
  if (!workflow?.permissions) error(`${name}: top-level permissions must be explicit`);
  if (/\bpull_request_target\s*:/.test(source)) error(`${name}: pull_request_target is forbidden`);
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*-\s+uses:\s+[^.]/.test(line) && !/#\s+v\d/.test(line)) {
      error(`${name}: pinned action must retain its source tag in a comment: ${line.trim()}`);
    }
  }
  visit(workflow, name);
}

const releaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'release-please-config.json'), 'utf8'));
const releasePackage = releaseConfig.packages?.['.'];
if (releasePackage?.['release-type'] !== 'node') error('release-please root package must use the node strategy');
if (releasePackage?.draft !== true || releasePackage?.['force-tag-creation'] !== true) {
  error('release-please must create a tag-backed draft GitHub Release');
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.release-please-manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest['.'] !== packageJson.version) error('release-please manifest version does not match package.json');

process.exit(failed ? 1 : 0);
