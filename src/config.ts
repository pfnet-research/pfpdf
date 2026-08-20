/** ConfigResolver: built-in defaults < environment variables < CLI arguments. */
import path from 'node:path';
import { BUNDLED_TEMPLATE_NAMES } from './bundled-templates.js';
import { InputError } from './errors.js';
import { validateTitle } from './input.js';
import { parseRepositoryLocator } from './repository.js';

export type Source = 'cli' | 'environment' | 'front-matter' | 'default';
export type CommandMode = 'convert' | 'doctor' | 'print-effective-config' | 'help' | 'version';

export interface ResolvedValue<T> {
  value: T;
  source: Source;
}

export interface Config {
  command: CommandMode;
  input: ResolvedValue<string | null>;
  output: ResolvedValue<string | null>;
  title: ResolvedValue<string | null>;
  toc: ResolvedValue<boolean>;
  template: ResolvedValue<
    { kind: 'bundled'; name: string } |
    { kind: 'custom'; dir: string } |
    { kind: 'repository'; locator: string }
  >;
  logo: ResolvedValue<
    { kind: 'template' } |
    { kind: 'none' } |
    { kind: 'local'; path: string } |
    { kind: 'repository'; locator: string }
  >;
  hostFonts: ResolvedValue<boolean>;
  fontDirs: ResolvedValue<string[]>;
  browserPath: ResolvedValue<string | null>;
  renderTimeoutMs: ResolvedValue<number>;
  keepWorkDir: ResolvedValue<boolean>;
  logLevel: ResolvedValue<'error' | 'warn' | 'info' | 'debug'>;
  /** Absolute path forms for execution; original text is kept in the ResolvedValue. */
  inputAbs: string | null;
  outputAbs: string | null;
  logoAbs: string | null;
  templateDirAbs: string | null;
  fontDirsAbs: string[];
  browserPathAbs: string | null;
  cwd: string;
}

interface RawCli {
  [key: string]: string | boolean | string[] | undefined;
}

const VALUE_OPTIONS = new Set([
  '--input', '--output', '--title', '--template', '--template-preset', '--logo',
  '--font-dir', '--browser-path',
  '--render-timeout-ms', '--log-level',
]);
const FLAG_OPTIONS = new Set([
  '--toc', '--no-toc', '--host-fonts', '--no-host-fonts', '--no-font-dirs',
  '--no-logo', '--managed-browser',
  '--keep-work-dir', '--no-keep-work-dir',
  '--print-effective-config', '--doctor', '--version', '--help', '-h',
]);
const PATH_OPTIONS = new Set([
  '--input', '--output', '--template', '--template-preset', '--logo', '--font-dir', '--browser-path',
]);

const CONFLICT_PAIRS: Array<[string, string]> = [
  ['--toc', '--no-toc'],
  ['--host-fonts', '--no-host-fonts'],
  ['--logo', '--no-logo'],
  ['--template', '--template-preset'],
  ['--font-dir', '--no-font-dirs'],
  ['--browser-path', '--managed-browser'],
  ['--keep-work-dir', '--no-keep-work-dir'],
];

function rejectNul(name: string, value: string): string {
  if (value.includes('\0')) throw new InputError(`${name}: NUL character is not allowed`);
  return value;
}

export function parseArgv(argv: string[]): RawCli {
  const seen = new Map<string, number>();
  const raw: RawCli = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new InputError(`missing value for ${arg}`);
      if (value === '' && PATH_OPTIONS.has(arg)) {
        throw new InputError(`${arg}: empty path is not allowed`);
      }
      i++;
      seen.set(arg, (seen.get(arg) ?? 0) + 1);
      if (arg === '--font-dir') {
        const list = (raw['--font-dir'] as string[] | undefined) ?? [];
        list.push(rejectNul(arg, value));
        raw['--font-dir'] = list;
      } else {
        if ((seen.get(arg) ?? 0) > 1) throw new InputError(`${arg} may not be repeated`);
        raw[arg] = rejectNul(arg, value);
      }
    } else if (FLAG_OPTIONS.has(arg)) {
      const key = arg === '-h' ? '--help' : arg;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if ((seen.get(key) ?? 0) > 1) throw new InputError(`${key} may not be repeated`);
      raw[key] = true;
    } else if (arg.startsWith('-')) {
      throw new InputError(`unknown option: ${arg}`);
    } else {
      throw new InputError(`unexpected positional argument: ${arg}`);
    }
  }
  for (const [a, b] of CONFLICT_PAIRS) {
    if (raw[a] !== undefined && raw[b] !== undefined) {
      throw new InputError(`${a} and ${b} may not be combined`);
    }
  }
  const modes = ['--doctor', '--print-effective-config', '--help', '--version'].filter(
    (m) => raw[m] !== undefined,
  );
  if (modes.length > 1) throw new InputError(`command modes may not be combined: ${modes.join(', ')}`);
  return raw;
}

function parseEnvBoolean(name: string, value: string): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new InputError(`${name}: expected true/false/1/0, got ${JSON.stringify(value)}`);
}

function parseTimeout(source: string, value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new InputError(`${source}: expected a decimal integer`);
  const n = Number(value);
  if (n < 1000 || n > 3600000) {
    throw new InputError(`${source}: must be between 1000 and 3600000 milliseconds`);
  }
  return n;
}

function resolveTemplateSetting(
  raw: RawCli,
  env: Record<string, string | undefined>,
): Config['template'] {
  const cliTpl = raw['--template'] as string | undefined;
  const cliPreset = raw['--template-preset'] as string | undefined;
  const envTpl = env['PFPDF_TEMPLATE'];
  const envPreset = env['PFPDF_TEMPLATE_PRESET'];
  if (cliTpl === undefined && cliPreset === undefined && envTpl !== undefined && envPreset !== undefined) {
    throw new InputError('PFPDF_TEMPLATE and PFPDF_TEMPLATE_PRESET may not be combined');
  }
  if (cliPreset !== undefined) {
    return { value: bundledTemplate(cliPreset, '--template-preset'), source: 'cli' };
  }
  if (cliTpl !== undefined) {
    return { value: parseTemplateSource(cliTpl, '--template'), source: 'cli' };
  }
  if (envPreset !== undefined) {
    if (envPreset === '') throw new InputError('PFPDF_TEMPLATE_PRESET: empty value is not allowed');
    return {
      value: bundledTemplate(rejectNul('PFPDF_TEMPLATE_PRESET', envPreset), 'PFPDF_TEMPLATE_PRESET'),
      source: 'environment',
    };
  }
  if (envTpl !== undefined) {
    if (envTpl === '') throw new InputError('PFPDF_TEMPLATE: empty value is not allowed');
    return {
      value: parseTemplateSource(rejectNul('PFPDF_TEMPLATE', envTpl), 'PFPDF_TEMPLATE'),
      source: 'environment',
    };
  }
  return { value: { kind: 'bundled', name: 'default' }, source: 'default' };
}

function bundledTemplate(name: string, source: string): { kind: 'bundled'; name: string } {
  if (!BUNDLED_TEMPLATE_NAMES.includes(name)) {
    throw new InputError(`${source}: unknown bundled template: ${name}`);
  }
  return { kind: 'bundled', name };
}

function parseTemplateSource(value: string, source: string): Config['template']['value'] {
  if (BUNDLED_TEMPLATE_NAMES.includes(value)) return { kind: 'bundled', name: value };
  if (value.startsWith('git::')) {
    parseRepositoryLocator(value, source);
    return { kind: 'repository', locator: value };
  }
  return { kind: 'custom', dir: value };
}

function parseLogoSource(value: string, source: string): Config['logo']['value'] {
  if (value.startsWith('git::')) {
    parseRepositoryLocator(value, source);
    return { kind: 'repository', locator: value };
  }
  return { kind: 'local', path: value };
}

function resolveLogoSetting(
  raw: RawCli,
  env: Record<string, string | undefined>,
): Config['logo'] {
  const cliLogo = raw['--logo'] as string | undefined;
  if (cliLogo !== undefined) {
    return { value: parseLogoSource(cliLogo, '--logo'), source: 'cli' };
  }
  if (raw['--no-logo'] !== undefined) return { value: { kind: 'none' }, source: 'cli' };

  const envLogo = env['PFPDF_LOGO'];
  if (envLogo === '') throw new InputError('PFPDF_LOGO: empty value is not allowed');
  if (envLogo !== undefined) {
    const value = rejectNul('PFPDF_LOGO', envLogo);
    return { value: parseLogoSource(value, 'PFPDF_LOGO'), source: 'environment' };
  }
  return { value: { kind: 'template' }, source: 'default' };
}

export function resolveConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Config {
  const raw = parseArgv(argv);

  const command: CommandMode = raw['--help']
    ? 'help'
    : raw['--version']
      ? 'version'
      : raw['--doctor']
        ? 'doctor'
        : raw['--print-effective-config']
          ? 'print-effective-config'
          : 'convert';

  function str(cliKey: string, envKey: string | null): ResolvedValue<string | null> {
    const cli = raw[cliKey] as string | undefined;
    if (cli !== undefined) return { value: cli, source: 'cli' };
    const e = envKey ? env[envKey] : undefined;
    if (e !== undefined) {
      if (e === '') throw new InputError(`${envKey}: empty value is not allowed`);
      return { value: rejectNul(envKey!, e), source: 'environment' };
    }
    return { value: null, source: 'default' };
  }

  function bool(
    posKey: string,
    negKey: string,
    envKey: string,
    def: boolean,
  ): ResolvedValue<boolean> {
    if (raw[posKey] !== undefined) return { value: true, source: 'cli' };
    if (raw[negKey] !== undefined) return { value: false, source: 'cli' };
    const e = env[envKey];
    if (e !== undefined) return { value: parseEnvBoolean(envKey, e), source: 'environment' };
    return { value: def, source: 'default' };
  }

  // Optional path settings where a bare CLI negative flag resets the environment.
  function optionalPath(
    cliKey: string,
    negKey: string,
    envKey: string,
  ): ResolvedValue<string | null> {
    const cli = raw[cliKey] as string | undefined;
    if (cli !== undefined) return { value: cli, source: 'cli' };
    if (raw[negKey] !== undefined) return { value: null, source: 'cli' };
    const e = env[envKey];
    if (e !== undefined) {
      if (e === '') throw new InputError(`${envKey}: empty path is not allowed`);
      return { value: rejectNul(envKey, e), source: 'environment' };
    }
    return { value: null, source: 'default' };
  }

  const input = str('--input', null);
  const output = str('--output', null);
  const title = str('--title', null);
  const toc = bool('--toc', '--no-toc', 'PFPDF_TOC', true);
  const hostFonts = bool('--host-fonts', '--no-host-fonts', 'PFPDF_HOST_FONTS', false);
  const keepWorkDir = bool('--keep-work-dir', '--no-keep-work-dir', 'PFPDF_KEEP_WORK_DIR', false);
  const browserPath = optionalPath('--browser-path', '--managed-browser', 'PFPDF_BROWSER_PATH');

  const template = resolveTemplateSetting(raw, env);
  const logo = resolveLogoSetting(raw, env);

  // font dirs: CLI list replaces the environment list entirely.
  let fontDirs: ResolvedValue<string[]>;
  const cliFontDirs = raw['--font-dir'] as string[] | undefined;
  if (cliFontDirs !== undefined) {
    fontDirs = { value: cliFontDirs, source: 'cli' };
  } else if (raw['--no-font-dirs'] !== undefined) {
    fontDirs = { value: [], source: 'cli' };
  } else if (env['PFPDF_FONT_DIRS'] !== undefined) {
    const parts = env['PFPDF_FONT_DIRS'].split(path.delimiter);
    if (parts.some((p) => p === '')) {
      throw new InputError('PFPDF_FONT_DIRS: empty path component is not allowed');
    }
    fontDirs = { value: parts.map((p) => rejectNul('PFPDF_FONT_DIRS', p)), source: 'environment' };
  } else {
    fontDirs = { value: [], source: 'default' };
  }

  // render timeout
  let renderTimeoutMs: ResolvedValue<number>;
  const cliTimeout = raw['--render-timeout-ms'] as string | undefined;
  if (cliTimeout !== undefined) {
    renderTimeoutMs = { value: parseTimeout('--render-timeout-ms', cliTimeout), source: 'cli' };
  } else if (env['PFPDF_RENDER_TIMEOUT_MS'] !== undefined) {
    renderTimeoutMs = {
      value: parseTimeout('PFPDF_RENDER_TIMEOUT_MS', env['PFPDF_RENDER_TIMEOUT_MS']),
      source: 'environment',
    };
  } else {
    renderTimeoutMs = { value: 300000, source: 'default' };
  }

  // log level
  let logLevel: ResolvedValue<'error' | 'warn' | 'info' | 'debug'>;
  {
    const v = str('--log-level', 'PFPDF_LOG_LEVEL');
    if (v.value === null) {
      logLevel = { value: 'warn', source: 'default' };
    } else if (v.value === 'error' || v.value === 'warn' || v.value === 'info' || v.value === 'debug') {
      logLevel = { value: v.value, source: v.source };
    } else {
      throw new InputError(`--log-level: expected error/warn/info/debug, got ${JSON.stringify(v.value)}`);
    }
  }

  if (input.value === '' || output.value === '') {
    throw new InputError(`${input.value === '' ? '--input' : '--output'}: empty path is not allowed`);
  }
  if (input.value === '-' || output.value === '-') {
    throw new InputError('stdin/stdout ("-") is not supported; use named paths');
  }
  if (command === 'convert') {
    if (input.value === null) throw new InputError('--input is required');
    if (output.value === null) throw new InputError('--output is required');
  }

  const abs = (p: string | null): string | null => (p === null ? null : path.resolve(cwd, p));

  return {
    command,
    input,
    output,
    title,
    toc,
    template,
    logo,
    hostFonts,
    fontDirs,
    browserPath,
    renderTimeoutMs,
    keepWorkDir,
    logLevel,
    inputAbs: abs(input.value),
    outputAbs: abs(output.value),
    logoAbs: logo.value.kind === 'local' ? abs(logo.value.path) : null,
    templateDirAbs: template.value.kind === 'custom' ? abs(template.value.dir) : null,
    fontDirsAbs: fontDirs.value.map((p) => path.resolve(cwd, p)),
    browserPathAbs: abs(browserPath.value),
    cwd,
  };
}

/** Apply a bundled template selected by the document when no external source overrides it. */
export function applyFrontMatterTemplate(config: Config, name: string | null): Config {
  if (name === null || config.template.source !== 'default') return config;
  return {
    ...config,
    template: { value: { kind: 'bundled', name }, source: 'front-matter' },
    templateDirAbs: null,
  };
}

export function effectiveConfigJson(config: Config): string {
  const entry = <T>(v: ResolvedValue<T>) => ({ value: v.value, source: v.source });
  const obj = {
    schemaVersion: 4,
    command: config.command,
    config: {
      input: entry(config.input),
      output: entry(config.output),
      title: entry(config.title),
      toc: entry(config.toc),
      template: entry(config.template),
      logo: entry(config.logo),
      hostFonts: entry(config.hostFonts),
      fontDirs: entry(config.fontDirs),
      browserPath: entry(config.browserPath),
      renderTimeoutMs: entry(config.renderTimeoutMs),
      keepWorkDir: entry(config.keepWorkDir),
      logLevel: entry(config.logLevel),
    },
  };
  return JSON.stringify(obj) + '\n';
}

/** Validate values that will not be consumed by a command's normal input phase. */
export function validateConfigForMode(config: Config): void {
  if (
    config.title.value !== null &&
    (config.command === 'help' || config.command === 'version' ||
      config.command === 'print-effective-config' ||
      (config.command === 'doctor' && config.inputAbs === null))
  ) {
    validateTitle(config.title.value);
  }
}

export const HELP_TEXT = `Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       Markdown file or a directory containing Markdown files
  --output PATH      destination .pdf path

Options:
  --title TEXT             override the front matter title
  --toc / --no-toc         enable / disable table of contents (default: on)
  --template SOURCE        preset name, local directory, or git::URL//PATH?ref=REVISION
  --template-preset NAME   explicitly select a bundled template preset
  --logo SOURCE            local file or git::URL//PATH?ref=REVISION; overrides template default
  --no-logo                disable local, repository, and template default logos
  --host-fonts             search OS standard font directories
  --no-host-fonts          disable host fonts requested via environment
  --font-dir PATH          extra font directory (repeatable)
  --no-font-dirs           disable extra font directories from environment
  --browser-path PATH      browser used by the renderer
  --managed-browser        disable the browser path from environment
  --render-timeout-ms N    absolute deadline in ms (default: 300000)
  --keep-work-dir / --no-keep-work-dir
                           keep the temporary workspace / disable env setting
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config print resolved configuration as JSON and exit
  --doctor                 diagnose renderer, browser, and assets
  --version                print the version
  -h, --help               print this help
`;
