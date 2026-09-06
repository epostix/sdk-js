import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('.codegen.json', 'utf8'));

const specBytes = readFileSync('openapi/developer-v1.yaml');
const specHash = createHash('sha256').update(specBytes).digest('hex');

let failures = 0;

if (specHash !== manifest.spec.raw_sha256) {
  console.error('the vendored spec does not match .codegen.json');
  failures += 1;
}

for (const [path, expected] of Object.entries(manifest.files)) {
  if (!existsSync(path)) {
    console.error(`missing generated file: ${path}`);
    failures += 1;
    continue;
  }

  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) {
    console.error(`generated file was edited by hand: ${path}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`${failures} integrity failure(s). Regenerate with epostix-codegen and commit the result.`);
  process.exit(1);
}

console.log(`contract ok: ${Object.keys(manifest.files).length} generated files, spec ${specHash.slice(0, 12)}`);
