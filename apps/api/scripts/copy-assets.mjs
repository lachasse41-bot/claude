import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = ['db/schema.sql'];

for (const rel of assets) {
  const from = path.join(root, 'src', rel);
  const to = path.join(root, 'dist', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${rel}`);
}
