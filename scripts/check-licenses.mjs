import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const prohibited = /(?:^|\W)(?:AGPL|SSPL|BUSL|BSL-1\.1|Elastic-License|Commons-Clause)(?:\W|$)/i;
const unknown = [];
const rejected = [];
const weakCopyleft = [];

for (const [path, metadata] of Object.entries(lock.packages || {})) {
  if (!path.includes('node_modules/')) continue;
  const license = typeof metadata.license === 'string' ? metadata.license : '';
  if (!license) unknown.push(path);
  else if (prohibited.test(license) || (/(?:^|\W)GPL-/i.test(license) && !/LGPL/i.test(license))) {
    rejected.push(`${path}: ${license}`);
  } else if (/(?:LGPL|MPL)/i.test(license)) weakCopyleft.push(`${path}: ${license}`);
}

if (unknown.length || rejected.length) {
  if (unknown.length) console.error(`Missing license metadata:\n${unknown.join('\n')}`);
  if (rejected.length) console.error(`Prohibited licenses:\n${rejected.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    `License metadata checked for ${Object.keys(lock.packages).length - 1} locked packages.`,
  );
  if (weakCopyleft.length) {
    console.log('Review-required weak-copyleft development dependencies:');
    console.log(weakCopyleft.join('\n'));
  }
}
