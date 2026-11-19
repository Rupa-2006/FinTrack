// Audit chain tools (run from backend/):
//
//   npm run audit:verify                 recompute the whole chain and check every saved anchor
//   npm run audit:anchor                 save the current chain head as an anchor file
//
// Anchors live in backend/audit-anchors/ (git-ignored). In production, copy them somewhere
// the database administrators cannot write to (another account, object storage with
// retention, a printed report). An anchor proves that the chain once ended at a given row
// with a given hash, so a rewritten or truncated tail is caught even if the remaining rows
// are self-consistent. Exit code 0 = intact, 1 = problem found, 2 = could not run.
const fs = require('fs/promises');
const path = require('path');
const database = require('../config/database');
const audit = require('../services/audit.service');

const ANCHOR_DIR = path.join(__dirname, '..', 'audit-anchors');

async function exportAnchor({ dir = ANCHOR_DIR } = {}) {
  const head = await audit.head();
  const anchor = { lastId: head.lastId, lastHash: head.lastHash, exportedAt: new Date().toISOString() };
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `anchor-${anchor.exportedAt.replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(file, `${JSON.stringify(anchor, null, 2)}\n`, { flag: 'wx' });
  return { file, anchor };
}

async function readAnchors(dir = ANCHOR_DIR) {
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const anchors = [];
  for (const name of names) anchors.push({ name, ...JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) });
  return anchors;
}

async function verify({ dir = ANCHOR_DIR } = {}) {
  const chain = await audit.verifyChain();
  const anchors = [];
  for (const anchor of await readAnchors(dir)) anchors.push({ name: anchor.name, lastId: anchor.lastId, ok: await audit.checkAnchor(anchor) });
  return { chain, anchors, ok: chain.valid && anchors.every((anchor) => anchor.ok) };
}

async function main() {
  const command = process.argv[2];
  if (command === 'anchor') {
    const { file, anchor } = await exportAnchor();
    console.log(`Anchor saved: ${path.relative(process.cwd(), file)} (row ${anchor.lastId})`);
    return 0;
  }
  if (command === 'verify') {
    const { chain, anchors, ok } = await verify();
    console.log(chain.valid ? `Chain intact: ${chain.checkedRows} rows checked, head at row ${chain.lastId}.` : `CHAIN BROKEN: ${chain.reason}`);
    if (!anchors.length) console.log('No anchors saved yet. Run "npm run audit:anchor" regularly and keep the files outside the database server.');
    for (const anchor of anchors) console.log(`${anchor.ok ? 'ok     ' : 'MISSING'} anchor ${anchor.name} (row ${anchor.lastId})`);
    return ok ? 0 : 1;
  }
  console.error('Usage: node scripts/audit-chain.js verify | anchor');
  return 2;
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`Could not run: ${err.message}`);
      process.exitCode = 2;
    })
    .finally(() => database.close());
}

module.exports = { exportAnchor, readAnchors, verify };
