// Cross-platform E2E test launcher. Avoid shell-specific environment syntax.
import { spawnSync } from 'node:child_process';

// Separate test files share Vivliostyle's browser cache. Serialize their first
// launches so concurrent downloads cannot overwrite the same browser archive.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'dist/tests/*.test.js'], {
  shell: false,
  stdio: 'inherit',
  env: { ...process.env, RUN_E2E: '1' },
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
