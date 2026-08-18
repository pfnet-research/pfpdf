/** --doctor: bounded, non-mutating environment and configuration diagnostics. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import type { Config } from './config.js';
import { buildHtml, type Logger } from './build.js';
import { resolveFonts } from './fonts.js';
import { ResourceManifest } from './resources.js';
import { resolveTemplate, type PreparedTemplate } from './template.js';
import { MIN_NODE, runtimeIsSupported } from './runtime.js';
import {
  rendererChildEnv,
  resolveVivliostyleCli,
} from './renderer.js';

interface Check {
  id: string;
  status: 'pass' | 'warning' | 'fail' | 'not-run';
  message: string;
}

const NOOP_LOGGER: Logger = { warn: () => {}, info: () => {}, debug: () => {} };

export async function runDoctor(
  config: Config,
  env: Record<string, string | undefined> = process.env,
  log: Logger = NOOP_LOGGER,
): Promise<{ json: string; exitCode: number }> {
  const checks: Check[] = [];
  const add = (id: string, status: Check['status'], message: string): void => {
    checks.push({ id, status, message });
  };

  const nodeOk = runtimeIsSupported(process.versions.node);
  add(
    'node-version',
    nodeOk ? 'pass' : 'fail',
    `Node.js ${process.versions.node}${nodeOk ? '' : ` (>= ${MIN_NODE.join('.')} required)`}`,
  );

  try {
    const cli = resolveVivliostyleCli();
    fs.accessSync(cli, fs.constants.R_OK);
    add('vivliostyle-cli', 'pass', cli);
  } catch (e) {
    add('vivliostyle-cli', 'fail', (e as Error).message);
  }

  let preparedTemplate: PreparedTemplate | undefined;
  let templateError: Error | undefined;
  try {
    preparedTemplate = resolveTemplate(config.template.value, config.templateDirAbs);
    const tpl = preparedTemplate;
    add('template', 'pass', `template resolved at ${tpl.dir}`);
  } catch (e) {
    templateError = e as Error;
    add('template', 'fail', templateError.message);
  }

  if (config.inputAbs === null) {
    addStandaloneLogoCheck(config, add);
  }

  const browserPath = config.browserPathAbs ?? await managedBrowserPath();
  if (browserPath === null) {
    add('browser', 'warning', 'managed browser is not installed yet; conversion will attempt to download it');
  } else {
    try {
      const browser = await probeBrowser(browserPath);
      add('browser', browser.status, browser.message);
    } catch (e) {
      add('browser', 'fail', `browser diagnostic failed: ${(e as Error).message}`);
    }
  }

  if (config.inputAbs !== null) {
    if (templateError !== undefined) {
      add('logo', 'not-run', 'template preparation failed');
      add('input', 'not-run', 'template preparation failed');
      addFailedFontChecks(config, templateError, add);
    } else {
      try {
        const warnings: string[] = [];
        const result = await buildHtml(config, env, {
          warn: (message) => { warnings.push(message); log.debug(message); },
          info: log.info,
          debug: log.debug,
        }, preparedTemplate);
        add(
          'input',
          warnings.length === 0 ? 'pass' : 'warning',
          `${result.manifest.list().length} local resource(s) resolved${warnings.length ? `; ${warnings.length} warning(s)` : ''}`,
        );
        add('logo', config.logoAbs === null ? 'not-run' : 'pass', config.logoAbs ?? 'no logo configured');
        addFontChecks(config, result.fontWarnings, add);
      } catch (e) {
        add('input', 'fail', (e as Error).message);
        const logoFailure = config.logoAbs !== null && (e as Error).message.includes(config.logoAbs);
        add('logo', logoFailure ? 'fail' : 'not-run', logoFailure ? (e as Error).message : 'input preparation did not complete');
        addFailedFontChecks(config, e as Error, add);
      }
    }
  } else {
    add('input', 'not-run', 'no input specified');
    try {
      const fontResult = resolveFonts(new ResourceManifest(), config.fontDirsAbs, config.hostFonts.value);
      addFontChecks(config, fontResult.warnings, add);
    } catch (e) {
      addFailedFontChecks(config, e as Error, add);
    }
  }

  if (config.outputAbs !== null) {
    const probe = probeOutputParent(config.outputAbs);
    add('output-parent', probe.status, probe.message);
  } else {
    add('output-parent', 'not-run', 'no output specified');
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warning');
  const status = hasFail ? 'fail' : hasWarning ? 'warning' : 'pass';
  return {
    json: JSON.stringify({ schemaVersion: 2, command: 'doctor', status, checks }) + '\n',
    exitCode: hasFail ? 1 : 0,
  };
}

function addStandaloneLogoCheck(
  config: Config,
  add: (id: string, status: Check['status'], message: string) => void,
): void {
  if (config.logoAbs === null) {
    add('logo', 'not-run', 'no logo configured');
    return;
  }
  try {
    new ResourceManifest().add(config.logoAbs);
    add('logo', 'pass', config.logoAbs);
  } catch (error) {
    add('logo', 'fail', (error as Error).message);
  }
}

function probeOutputParent(outputPath: string): Pick<Check, 'status' | 'message'> {
  let parent = path.dirname(outputPath);
  while (!fs.existsSync(parent)) {
    const ancestor = path.dirname(parent);
    if (ancestor === parent) break;
    parent = ancestor;
  }
  const token = crypto.randomBytes(8).toString('hex');
  const created = path.join(parent, `.pfpdf-doctor-${token}.tmp`);
  const renamed = path.join(parent, `.pfpdf-doctor-${token}.renamed`);
  let result: Pick<Check, 'status' | 'message'>;
  try {
    const fd = fs.openSync(created, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.closeSync(fd);
    fs.renameSync(created, renamed);
    result = { status: 'pass', message: `temporary sibling create and rename succeeded: ${parent}` };
  } catch (error) {
    result = { status: 'fail', message: `temporary sibling create or rename failed in ${parent}: ${(error as Error).message}` };
  }
  try {
    fs.rmSync(created, { force: true });
    fs.rmSync(renamed, { force: true });
  } catch (error) {
    result = { status: 'fail', message: `cannot remove output diagnostic probe in ${parent}: ${(error as Error).message}` };
  }
  return result;
}

function addFontChecks(
  config: Config,
  warnings: string[],
  add: (id: string, status: Check['status'], message: string) => void,
): void {
  for (const [i, dir] of config.fontDirsAbs.entries()) add(`font-dir-${i + 1}`, 'pass', dir);
  add(
    'fonts',
    warnings.length === 0 ? 'pass' : 'warning',
    warnings.length === 0
      ? 'bundled and configured fonts are usable'
      : `${warnings.length} font warning(s): ${warnings[0]}`,
  );
}

function addFailedFontChecks(
  config: Config,
  error: Error,
  add: (id: string, status: Check['status'], message: string) => void,
): void {
  const fontFailure = /\bfont\b/i.test(error.message);
  for (const [i, dir] of config.fontDirsAbs.entries()) {
    add(
      `font-dir-${i + 1}`,
      fontFailure && error.message.includes(dir) ? 'fail' : 'not-run',
      fontFailure && error.message.includes(dir) ? error.message : 'font preparation did not complete',
    );
  }
  add('fonts', fontFailure ? 'fail' : 'not-run', fontFailure ? error.message : 'input preparation did not reach completion');
}

async function managedBrowserPath(): Promise<string | null> {
  if (process.platform === 'linux' && process.arch === 'arm64' && fs.existsSync('/usr/bin/chromium')) {
    return '/usr/bin/chromium';
  }
  const cacheDir = vivliostyleBrowserCacheDir();
  try {
    const installed = await getInstalledBrowsers({ cacheDir });
    // The public API exposes installed browsers, but not which private
    // Vivliostyle cache record is preferred. Probe an installed candidate and
    // report null when none is discoverable without interpreting cache files.
    return installed[0]?.executablePath ?? null;
  } catch {
    return null;
  }
}

function vivliostyleBrowserCacheDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  const localAppData = process.env.LOCALAPPDATA;
  const base = process.platform === 'linux'
    ? (xdgCacheHome === undefined || xdgCacheHome === '' ? path.join(os.homedir(), '.cache') : xdgCacheHome)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches')
      : (localAppData === undefined || localAppData === '' ? path.join(os.homedir(), 'AppData', 'Local') : localAppData);
  return path.join(base, 'vivliostyle', 'browsers');
}

async function probeBrowser(browserPath: string): Promise<Pick<Check, 'status' | 'message'>> {
  try {
    if (!fs.statSync(browserPath).isFile()) throw new Error('not a regular file');
    fs.accessSync(browserPath, fs.constants.X_OK);
  } catch {
    return { status: 'fail', message: `browser not executable: ${browserPath}` };
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-doctor-browser-'));
  const input = path.join(workspace, 'probe.md');
  const output = path.join(workspace, 'probe.pdf');
  fs.writeFileSync(input, '---\ntitle: pfpdf doctor\n---\n\nbrowser check\n', { mode: 0o600 });
  let outcome: Pick<Check, 'status' | 'message'>;
  try {
    const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), 'launcher.js');
    const result = spawnSync(process.execPath, [
      launcher, '--input', input, '--output', output, '--browser-path', browserPath,
      '--template', 'default', '--no-logo', '--no-host-fonts', '--no-font-dirs',
      '--render-timeout-ms', '10000', '--log-level', 'error',
    ], {
      shell: false,
      timeout: 12000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: { ...rendererChildEnv(), SOURCE_DATE_EPOCH: '0' },
    });
    let pdfOk = false;
    try { pdfOk = fs.readFileSync(output).subarray(0, 5).toString('latin1') === '%PDF-'; }
    catch { pdfOk = false; }
    if (result.status !== 0 || !pdfOk) {
      const detail = result.error?.message ?? `conversion exited with ${result.status ?? result.signal ?? 'unknown status'}`;
      outcome = { status: 'fail', message: `browser failed its isolated headless launch check: ${browserPath}: ${detail}` };
    } else {
      outcome = { status: 'pass', message: `browser launched successfully: ${browserPath}` };
    }
  } catch (e) {
    outcome = {
      status: 'fail',
      message: `browser failed its isolated headless launch check: ${browserPath}: ${(e as Error).message}`,
    };
  }
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch (e) {
    return { status: 'fail', message: `cannot remove diagnostic browser profile: ${(e as Error).message}` };
  }
  return outcome;
}
