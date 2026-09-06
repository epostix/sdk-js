import { rmSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

rmSync('dist', { recursive: true, force: true });

function sourceFiles(dir) {
  const out = [];

  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }

  return out;
}

const entryPoints = sourceFiles('src');

const rewriteExtensions = {
  name: 'rewrite-ts-specifiers',
  setup(build) {
    build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
      if (args.kind === 'entry-point') return undefined;

      return { path: args.path.replace(/\.ts$/, '.js'), external: true };
    });
  },
};

const shared = {
  entryPoints,
  bundle: true,
  packages: 'external',
  plugins: [rewriteExtensions],
  platform: 'neutral',
  target: 'es2023',
  sourcemap: true,
  outbase: 'src',
};

await esbuild.build({ ...shared, format: 'esm', outdir: 'dist/esm', outExtension: { '.js': '.js' } });
await esbuild.build({ ...shared, format: 'cjs', outdir: 'dist/cjs', platform: 'node', outExtension: { '.js': '.js' } });

execFileSync(
  'node_modules/.bin/tsc',
  ['-p', 'tsconfig.build.json'],
  { stdio: 'inherit' },
);

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');

console.log('built dist/esm, dist/cjs, dist/types');
