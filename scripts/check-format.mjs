/**
 * Check formatting for the exact change being pushed.
 *
 * The repository contains historical and generated files that predate the
 * current Prettier rules. Checking every file would make unrelated legacy
 * formatting block every release. Locally we check the staged diff; in CI
 * (where the index is empty) we check the latest commit.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prettierBin = require.resolve('prettier/bin/prettier.cjs');
const supported = /\.(?:[cm]?[jt]sx?|json|md|ya?ml)$/i;

function gitFiles(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

let files = gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
if (files.length === 0) {
  files = gitFiles(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
}

files = [...new Set(files)].filter((file) => supported.test(file) && existsSync(file));

if (files.length === 0) {
  console.log('No changed Prettier-supported files to check.');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [prettierBin, '--check', ...files, '--ignore-path', '.prettierignore'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
