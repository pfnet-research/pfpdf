#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReleaseArtifacts,
  finalizeGitHubRelease,
  inspectNpmPack,
  registryStatus,
  stageGitHubRelease,
  testPackedPackage,
  validateReleaseSource,
  verifyPublishedPackage,
  verifyReleaseArtifacts,
  writeReleaseSummary,
} from './release-lib.mjs';

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid option list near ${key ?? '<end>'}`);
    result[key.slice(2)] = value;
  }
  return result;
}

function required(value, name) {
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const command = process.argv[2];
  const args = options(process.argv.slice(3));
  const root = path.resolve(args.root ?? path.dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
  let result;

  switch (command) {
    case 'validate-source':
      result = validateReleaseSource({
        root,
        tag: required(args.tag, 'tag'),
        sha: args.sha ?? null,
      });
      break;
    case 'inspect-pack': {
      const source = validateReleaseSource({ root, tag: required(args.tag, 'tag'), sha: args.sha ?? null });
      result = inspectNpmPack({
        packJsonPath: path.resolve(required(args['pack-json'], 'pack-json')),
        expectedName: source.name,
        expectedVersion: source.version,
      });
      break;
    }
    case 'create-artifacts':
      result = createReleaseArtifacts({
        root,
        tag: required(args.tag, 'tag'),
        sha: required(args.sha, 'sha'),
        packJsonPath: path.resolve(required(args['pack-json'], 'pack-json')),
        pdfDir: path.resolve(required(args['pdf-dir'], 'pdf-dir')),
        browserVersion: required(args['browser-version'], 'browser-version'),
        outputPath: path.resolve(required(args.output, 'output')),
        checksumsPath: path.resolve(required(args.checksums, 'checksums')),
      });
      break;
    case 'verify-artifacts':
      result = verifyReleaseArtifacts({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    case 'test-packed':
      result = testPackedPackage({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    case 'registry-status':
      result = registryStatus({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    case 'summary':
      result = writeReleaseSummary({
        metadataPath: path.resolve(required(args.metadata, 'metadata')),
        outputPath: path.resolve(required(args.output, 'output')),
      });
      break;
    case 'verify-published':
      result = await verifyPublishedPackage({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    case 'stage-github':
      result = stageGitHubRelease({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    case 'finalize-github':
      result = finalizeGitHubRelease({ metadataPath: path.resolve(required(args.metadata, 'metadata')) });
      break;
    default:
      throw new Error(`unknown release command: ${command ?? '<none>'}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`release: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
