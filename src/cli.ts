#!/usr/bin/env node
/** pfpdf CLI entry point. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, effectiveConfigJson, validateConfigForMode, HELP_TEXT } from './config.js';
import { InputError, RuntimeError, exitCodeOf } from './errors.js';
import { runBuild, type Logger } from './build.js';
import { runDoctor } from './doctor.js';

const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function makeLogger(level: string): Logger {
  const threshold = LEVELS[level] ?? 1;
  const emit = (lvl: string, msg: string): void => {
    if ((LEVELS[lvl] ?? 1) <= threshold) {
      process.stderr.write(`pfpdf: ${lvl}: ${msg}\n`);
    }
  };
  return {
    warn: (m) => {
      emit('warn', m);
    },
    info: (m) => {
      emit('info', m);
    },
    debug: (m) => {
      emit('debug', m);
    },
  };
}

function packageVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

export async function main(): Promise<number> {
  let logLevel = 'warn';
  try {
    const config = resolveConfig(process.argv.slice(2), process.env, process.cwd());
    logLevel = config.logLevel.value;
    const log = makeLogger(logLevel);

    // Conversion validates the selected title while normalizing input metadata.
    // Modes that do not read input still validate an explicitly supplied value.
    validateConfigForMode(config);

    switch (config.command) {
      case 'help':
        process.stdout.write(HELP_TEXT);
        return 0;
      case 'version':
        process.stdout.write(packageVersion() + '\n');
        return 0;
      case 'print-effective-config':
        process.stdout.write(effectiveConfigJson(config));
        return 0;
      case 'doctor': {
        const { json, exitCode } = await runDoctor(config, process.env, log);
        process.stdout.write(json);
        return exitCode;
      }
      case 'convert': {
        const result = await runBuild(config, process.env, log);
        log.info(
          `wrote ${result.outputPath} (${result.byteSize} bytes, ${Math.round(result.elapsedMs / 100) / 10}s)`,
        );
        return 0;
      }
    }
  } catch (err) {
    if (err instanceof InputError || err instanceof RuntimeError) {
      process.stderr.write(`pfpdf: error: ${err.message}\n`);
      if (logLevel === 'debug' && err.stack) process.stderr.write(err.stack + '\n');
      return err.exitCode;
    }
    process.stderr.write(`pfpdf: internal error: ${String(err)}\n`);
    if (logLevel === 'debug' && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    return exitCodeOf(err);
  }
}
