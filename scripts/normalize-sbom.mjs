import { readFile } from 'node:fs/promises';

const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 20_000_000) throw new Error('SBOM exceeds the 20 MB normalization limit');
  chunks.push(chunk);
}

const bom = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const component = bom.metadata?.component;
if (!component || typeof component !== 'object') throw new Error('SBOM root component is missing');

const expectedReference = `${packageJson.name}@${packageJson.version}`;
const expectedPurl = `pkg:npm/${packageJson.name}@${packageJson.version}`;
component.type = 'application';
component.name = packageJson.name;
component.version = packageJson.version;
component['bom-ref'] = expectedReference;
component.purl = expectedPurl;

process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`);
