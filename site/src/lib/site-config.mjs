import { execFileSync } from 'node:child_process';

// The org / repo name must never be hardcoded: the repository is scheduled to
// move to another organization and the site may later get a custom domain.
// Everything absolute is derived from SITE_URL / GITHUB_REPOSITORY at build
// time; internal links are relative (see scripts/relativize-links.mjs).

function detectRepository() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
    }).trim();
    const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (match !== null) {
      return match[1];
    }
  } catch {
    // Not a git checkout (e.g. exported tarball); fall through.
  }
  return 'OWNER/pfpdf';
}

export const GITHUB_REPOSITORY = detectRepository();
export const REPO_URL = `https://github.com/${GITHUB_REPOSITORY}`;

function detectSiteUrl() {
  const fromEnv = process.env.SITE_URL;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  }
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

export const SITE_URL = detectSiteUrl();
