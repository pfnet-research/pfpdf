// Cross-platform E2E test launcher. Avoid shell-specific environment syntax.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'dist/tests/*.test.js'], {
  shell: false,
  stdio: 'inherit',
  env: { ...process.env, PFPDF_TEST_E2E: '1' },
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
