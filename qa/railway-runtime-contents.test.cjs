'use strict';
// Run from any checkout; fixtures and generated files are disposable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const htmlHash = 'a7edbf3783972e25ee134180af46f9ce5d763a318de63e0aa2cc4b8f5f76c35e';

function fixture(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-runtime-contents-'));
  t.after(() => fs.rmSync(scratch, {recursive:true, force:true}));
  const at = relative => path.join(scratch, relative);
  for (const name of ['tools/prepare_railway_secure.py', 'tools/railway-package-lock.json',
    'backend/railway','backend/auth','backend/supabase','Lucky_Game_Multiplayer_Test_v1.zip','prod-ca-2021.crt']) {
    fs.cpSync(path.join(root, name), at(name), {recursive:true});
  }
  const build = () => {
    const result = spawnSync('python3', ['tools/prepare_railway_secure.py'], {cwd:scratch,encoding:'utf8', timeout:10000});
    assert.ifError(result.error);
    return result;
  };
  return {at,build};
}

test('generated Railway output excludes unlisted input and files left over by an older build', t => {
  const {at,build} = fixture(t);
  const marker = 'fixture only';
  fs.writeFileSync(at('backend/supabase/.qa-unlisted-sentinel'), marker);
  fs.mkdirSync(at('railway-runtime/backend/railway/public'), {recursive:true});
  fs.writeFileSync(at('railway-runtime/backend/railway/public/old-build.txt'), marker);
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(at('railway-runtime/backend/railway/public/old-build.txt')), false);
  assert.deepEqual(fs.readdirSync(at('railway-runtime/backend/supabase')).sort(), [
    'game-store.cjs','manual-room-recovery.cjs','pg-tls-config.cjs','prod-ca-2021.crt',
    'room-lease-store.cjs','room-reconciliation.cjs'
  ]);
  const page = fs.readFileSync(at('railway-runtime/backend/railway/public/index.html'));
  assert.equal(createHash('sha256').update(page).digest('hex'), htmlHash);
  assert.deepEqual(fs.readFileSync(at('railway-runtime/package-lock.json')), fs.readFileSync(at('tools/railway-package-lock.json')));
  const manifest = JSON.parse(fs.readFileSync(at('railway-runtime/package.json')));
  assert.equal(manifest.scripts.start, 'node backend/railway/secure-server.cjs');
  for (const file of ['railway/secure-server.cjs','supabase/game-store.cjs','supabase/room-lease-store.cjs']) {
    const check = spawnSync(process.execPath, ['--check',at('railway-runtime/backend/'+file)], {encoding:'utf8',timeout:3000});
    assert.ifError(check.error);
    assert.equal(check.status,0,check.stderr);
  }
});

test('invalid tracked lock is rejected before publishing any new runtime files', t => {
  const {at,build} = fixture(t);
  fs.mkdirSync(at('railway-runtime/backend'), {recursive:true});
  fs.writeFileSync(at('railway-runtime/backend/previous.txt'), 'unchanged');
  const lock = JSON.parse(fs.readFileSync(at('tools/railway-package-lock.json')));
  lock.packages[''].dependencies.pg = '0.0.0';
  fs.writeFileSync(at('tools/railway-package-lock.json'), JSON.stringify(lock));
  const result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest and lockfile are out of sync/);
  assert.equal(fs.readFileSync(at('railway-runtime/backend/previous.txt'), 'utf8'), 'unchanged');
  assert.equal(fs.existsSync(at('railway-runtime/package.json')), false);
});
