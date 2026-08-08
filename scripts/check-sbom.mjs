const chunks = [];
let length = 0;

for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 20_000_000) throw new Error('SBOM exceeds the 20 MB validation limit');
  chunks.push(chunk);
}

const bom = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (bom.bomFormat !== 'CycloneDX') throw new Error('SBOM must use the CycloneDX format');
if (!/^1\.[5-9]$/.test(bom.specVersion || '')) {
  throw new Error(`Unsupported CycloneDX version: ${bom.specVersion || 'missing'}`);
}
if (!Array.isArray(bom.components) || bom.components.length < 10) {
  throw new Error('SBOM contains too few dependency components');
}
const root = bom.metadata?.component;
if (
  root?.name !== 'teamboundary-ai' ||
  root?.version !== '0.1.0' ||
  root?.['bom-ref'] !== 'teamboundary-ai@0.1.0' ||
  root?.purl !== 'pkg:npm/teamboundary-ai@0.1.0'
) {
  throw new Error('SBOM root component does not match package.json');
}
const obsoleteCheckoutName = ['edge', 'braid'].join('');
if (new RegExp(obsoleteCheckoutName, 'i').test(JSON.stringify(bom))) {
  throw new Error('SBOM contains the obsolete checkout/project name');
}

console.log(
  `CycloneDX ${bom.specVersion} SBOM validated with ${bom.components.length} components.`,
);
