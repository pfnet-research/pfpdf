#!/usr/bin/env node
/** Minimal entry point that checks the runtime before loading dependencies. */
import { MIN_NODE, runtimeIsSupported } from './runtime.js';

if (!runtimeIsSupported(process.versions.node)) {
  process.stderr.write(
    `pfpdf: error: Node.js >= ${MIN_NODE.join('.')} is required; current runtime is ${process.versions.node}\n`,
  );
  process.exitCode = 1;
} else {
  import('./cli.js').then(({ main }) => main())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`pfpdf: internal error: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
