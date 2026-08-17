/** ConfigResolver: built-in defaults < environment variables < CLI arguments. */
import path from 'node:path';
import { BUNDLED_TEMPLATE_NAMES } from './bundled-templates.js';
import { InputError } from './errors.js';
import { validateTitle } from './input.js';

export type Source = 'cli' | 'environment' | 'default';
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
  template: ResolvedValue<{ kind: 'bundled'; name: string } | { kind: 'custom'; dir: string }>;
  logo: ResolvedValue<string | null>;
  renderer: ResolvedValue<'local' | 'docker'>;
  hostFonts: ResolvedValue<boolean>;
  fontDirs: ResolvedValue<string[]>;
  browserPath: ResolvedValue<string | null>;
  dockerImage: ResolvedValue<string | null>;
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
  '--input', '--output', '--title', '--template', '--template-dir', '--logo',
  '--renderer', '--font-dir', '--browser-path', '--docker-image',
  '--render-timeout-ms', '--log-level',
]);
const FLAG_OPTIONS = new Set([
  '--toc', '--no-toc', '--host-fonts', '--no-host-fonts', '--no-font-dirs',
  '--no-logo', '--managed-browser', '--default-docker-image',
  '--keep-work-dir', '--no-keep-work-dir',
  '--print-effective-config', '--doctor', '--version', '--help', '-h',
]);
const PATH_OPTIONS = new Set([
  '--input', '--output', '--template-dir', '--logo', '--font-dir', '--browser-path',
]);

const CONFLICT_PAIRS: Array<[string, string]> = [
  ['--toc', '--no-toc'],
  ['--host-fonts', '--no-host-fonts'],
  ['--logo', '--no-logo'],
  ['--font-dir', '--no-font-dirs'],
  ['--browser-path', '--managed-browser'],
  ['--docker-image', '--default-docker-image'],
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
      if (value === '' && arg === '--docker-image') {
        throw new InputError('--docker-image: empty image reference is not allowed');
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
  if (raw['--template'] !== undefined && raw['--template-dir'] !== undefined) {
    throw new InputError('--template and --template-dir may not be combined');
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
  const logo = optionalPath('--logo', '--no-logo', 'PFPDF_LOGO');
  const browserPath = optionalPath('--browser-path', '--managed-browser', 'PFPDF_BROWSER_PATH');
  const dockerImage = optionalPath('--docker-image', '--default-docker-image', 'PFPDF_DOCKER_IMAGE');

  // template / template-dir is one logical setting.
  let template: Config['template'];
  const cliTpl = raw['--template'] as string | undefined;
  const cliTplDir = raw['--template-dir'] as string | undefined;
  const envTpl = env['PFPDF_TEMPLATE'];
  const envTplDir = env['PFPDF_TEMPLATE_DIR'];
  if (cliTpl === undefined && cliTplDir === undefined) {
    if (envTpl === '' || envTplDir === '') {
      throw new InputError(`${envTpl === '' ? 'PFPDF_TEMPLATE' : 'PFPDF_TEMPLATE_DIR'}: empty value is not allowed`);
    }
    if (envTpl !== undefined && envTplDir !== undefined) {
      throw new InputError('PFPDF_TEMPLATE and PFPDF_TEMPLATE_DIR may not be combined');
    }
  }
  if (cliTpl !== undefined) {
    template = { value: { kind: 'bundled', name: cliTpl }, source: 'cli' };
  } else if (cliTplDir !== undefined) {
    template = { value: { kind: 'custom', dir: cliTplDir }, source: 'cli' };
  } else if (envTplDir !== undefined) {
    template = { value: { kind: 'custom', dir: rejectNul('PFPDF_TEMPLATE_DIR', envTplDir) }, source: 'environment' };
  } else if (envTpl !== undefined) {
    template = { value: { kind: 'bundled', name: envTpl }, source: 'environment' };
  } else {
    template = { value: { kind: 'bundled', name: 'default' }, source: 'default' };
  }
  if (template.value.kind === 'bundled' && !BUNDLED_TEMPLATE_NAMES.includes(template.value.name)) {
    throw new InputError(`unknown bundled template: ${template.value.name}`);
  }

  // renderer
  let renderer: ResolvedValue<'local' | 'docker'>;
  {
    const v = str('--renderer', 'PFPDF_RENDERER');
    if (v.value === null) renderer = { value: 'local', source: 'default' };
    else if (v.value === 'local' || v.value === 'docker') renderer = { value: v.value, source: v.source };
    else throw new InputError(`--renderer: expected local or docker, got ${JSON.stringify(v.value)}`);
  }

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
    renderer,
    hostFonts,
    fontDirs,
    browserPath,
    dockerImage,
    renderTimeoutMs,
    keepWorkDir,
    logLevel,
    inputAbs: abs(input.value),
    outputAbs: abs(output.value),
    logoAbs: abs(logo.value),
    templateDirAbs: template.value.kind === 'custom' ? abs(template.value.dir) : null,
    fontDirsAbs: fontDirs.value.map((p) => path.resolve(cwd, p)),
    browserPathAbs: abs(browserPath.value),
    cwd,
  };
}

export function effectiveConfigJson(config: Config): string {
  const entry = <T>(v: ResolvedValue<T>) => ({ value: v.value, source: v.source });
  const obj = {
    schemaVersion: 1,
    command: config.command,
    config: {
      input: entry(config.input),
      output: entry(config.output),
      title: entry(config.title),
      toc: entry(config.toc),
      template: entry(config.template),
      logo: entry(config.logo),
      renderer: entry(config.renderer),
      hostFonts: entry(config.hostFonts),
      fontDirs: entry(config.fontDirs),
      browserPath: entry(config.browserPath),
      dockerImage: entry(config.dockerImage),
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
  --template NAME          bundled template name (default: default)
  --template-dir PATH      custom template directory
  --logo PATH / --no-logo  logo file for the template / disable env logo
  --renderer MODE          local or docker (default: local)
  --host-fonts             search OS standard font directories
  --no-host-fonts          disable host fonts requested via environment
  --font-dir PATH          extra font directory (repeatable)
  --no-font-dirs           disable extra font directories from environment
  --browser-path PATH      browser used by the local renderer
  --managed-browser        disable the browser path from environment
  --docker-image IMAGE     image used by the Docker renderer
  --default-docker-image   disable the image from environment
  --render-timeout-ms N    absolute deadline in ms (default: 300000)
  --keep-work-dir / --no-keep-work-dir
                           keep the temporary workspace / disable env setting
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config print resolved configuration as JSON and exit
  --doctor                 diagnose renderer, browser, and assets
  --version                print the version
  -h, --help               print this help
`;
