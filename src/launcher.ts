#!/usr/bin/env node
/** Minimal entry point that checks the runtime before loading dependencies. */
import { MIN_NODE, runtimeIsSupported } from './runtime.js';

if (!runtimeIsSupported(process.versions.node)) {
  process.stderr.write(
    `pfpdf: error: Node.js >= ${MIN_NODE.join('.')} is required; current runtime is ${process.versions.node}\n`,
  );
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const entry = args[0] === '--internal-render-job' && args.length === 2
    ? import('./internal-render.js').then(({ internalRenderMain }) => internalRenderMain(args[1]!))
    : import('./cli.js').then(({ main }) => main());
  entry
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`pfpdf: internal error: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
