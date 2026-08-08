import { execFileSync } from 'node:child_process';

const base = process.env.DCO_BASE_SHA?.trim() ?? '';
const head = process.env.DCO_HEAD_SHA?.trim() ?? '';
if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head)) {
  throw new Error('DCO_BASE_SHA and DCO_HEAD_SHA must be exact commit identifiers.');
}

const commits = execFileSync('git', ['rev-list', '--no-merges', `${base}..${head}`], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const failures = [];
for (const commit of commits) {
  const message = execFileSync('git', ['show', '-s', '--format=%B', commit], { encoding: 'utf8' });
  if (!/^Signed-off-by:\s+.+\s+<[^<>\s]+@[^<>\s]+>\s*$/im.test(message)) {
    failures.push(commit);
  }
}

if (failures.length) {
  throw new Error(`Missing DCO sign-off on commits: ${failures.join(', ')}`);
}
console.log(`DCO sign-off verified for ${commits.length} pull-request commits.`);
