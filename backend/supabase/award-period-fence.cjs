'use strict';
const {getPeriod}=require('../storage/score-periods.cjs');

// Each SQL template uses one database clock sample. The ledger's DEFAULT now()
// observes the same timestamp as transaction_timestamp() in this transaction.
function sample(clock) {
  return `WITH sample AS MATERIALIZED (SELECT ${clock} AS t),
    local_day AS (SELECT t,(t AT TIME ZONE 'Asia/Bangkok')::date AS d FROM sample)
    SELECT floor(extract(epoch FROM t)*1000)::bigint AS ms,
      (CASE WHEN $1::text='free' THEN d-extract(dow FROM d)::integer ELSE d END)
      -date '1970-01-01' AS key FROM local_day`;
}
const wall=sample('clock_timestamp()');
const transaction=sample('transaction_timestamp()');

async function readPeriod(client,sql,mode) {
  const {rows}=await client.query(sql,[mode]);
  const r=rows[0];
  if(rows.length!==1 || typeof r?.ms!=='string' || !/^\d+$/.test(r.ms))
    throw Error('INVALID_AWARD_CLOCK');
  const period=getPeriod(mode,Number(r.ms));
  const key=Math.floor((period.startMs+7*3600000)/86400000);
  if(period.startMs<0 || !Number.isInteger(r.key) || key!==r.key || key>2147483647)
    throw Error('INVALID_AWARD_PERIOD');
  return {...period,key};
}

// Caller owns one clean direct physical session. It must discard it on EVERY
// exit, including failure during BEGIN, so the session-level lock cannot leak.
async function beginAwardPeriod(client,mode) {
  if(!['free','vip'].includes(mode))throw Error('INVALID_AWARD_MODE');
  if(typeof client.getTransactionStatus!=='function' || client.getTransactionStatus()!=='I')
    throw Error('AWARD_CLIENT_NOT_IDLE');
  const before=await readPeriod(client,wall,mode);
  const ns=mode==='free'?1279739393:1279739394;
  const gate=await client.query('SELECT pg_try_advisory_lock_shared($1::int,$2::int) AS held',[ns,before.key]);
  if(gate.rows.length!==1 || gate.rows[0]?.held!==true)throw Error('AWARD_PERIOD_BUSY');
  const begin=await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  if(begin?.command!=='BEGIN' || client.getTransactionStatus()!=='T')throw Error('AWARD_BEGIN_UNCONFIRMED');
  const current=await readPeriod(client,transaction,mode);
  if(current.key!==before.key)throw Error('AWARD_PERIOD_CHANGED');
  // Proposed privileged predicate MUST see the complete archive for this key.
  // A runtime SELECT returning no RLS-visible rows would be insufficient.
  const proof=await client.query(
    'SELECT game.award_period_is_open($1::text,$2::bigint,$3::bigint) AS open',
    [mode,current.startMs,current.endMs]);
  if(proof.rows.length!==1 || proof.rows[0]?.open!==true)throw Error('AWARD_PERIOD_NOT_OPEN');
}
module.exports={beginAwardPeriod};
