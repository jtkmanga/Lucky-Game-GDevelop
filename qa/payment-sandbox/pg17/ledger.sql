-- QA only. Run via run.py in its newly initialized, disposable cluster.
BEGIN;
DO $guard$
BEGIN
 IF current_setting('server_version_num')::int / 10000 <> 17
 OR current_database() <> 'lucky_qa_item_ledger'
 OR current_setting('lucky.disposable_ledger',true) IS DISTINCT FROM 'on'
 OR split_part(pg_read_file('postmaster.pid',0,64), E'\n',1) <> (-pg_backend_pid())::text
 THEN RAISE EXCEPTION 'requires disposable PG17 standalone ledger'; END IF;
END $guard$;
CREATE ROLE lab_ledger_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE lab_verified_fixture NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE lab_item_snapshot_fixture NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE lab_receipt_lookup NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA lab_ledger AUTHORIZATION lab_ledger_owner;
SET LOCAL ROLE lab_ledger_owner;
REVOKE ALL ON SCHEMA lab_ledger FROM PUBLIC;
CREATE TABLE lab_ledger.orders (
 id text PRIMARY KEY CHECK(id ~ '^lab-order-[a-z0-9]+$'),
 uid text NOT NULL CHECK(uid ~ '^lab-uid-[a-z0-9]+$'),
 item text NOT NULL CHECK(item IN ('shield','double_win')),
 ref text NOT NULL UNIQUE CHECK(ref ~ '^lab-ref-[a-z0-9]+$'),
 amount integer NOT NULL CHECK(amount>0),
 currency text NOT NULL CHECK(currency='THB'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded'))
);
CREATE TABLE lab_ledger.audit (
 event text PRIMARY KEY CHECK(event ~ '^lab-event-[a-z0-9]+$'),
 order_id text NOT NULL REFERENCES lab_ledger.orders,
 action text NOT NULL CHECK(action IN ('settled','refunded')),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 refund_minor integer CHECK(refund_minor>0),
 applied boolean NOT NULL, accepted_at timestamptz NOT NULL,
 CHECK ((action='settled' AND refund_minor IS NULL)
   OR (action='refunded' AND refund_minor IS NOT NULL AND refund_minor=amount_minor)),
 actor name NOT NULL,
 UNIQUE(order_id,event)
);
CREATE TABLE lab_ledger.origins (
 order_id text PRIMARY KEY REFERENCES lab_ledger.orders,
 issue_event text NOT NULL, refund_event text,
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>starts_at),
 FOREIGN KEY(order_id,issue_event) REFERENCES lab_ledger.audit(order_id,event),
 FOREIGN KEY(order_id,refund_event) REFERENCES lab_ledger.audit(order_id,event)
);
ALTER TABLE lab_ledger.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_ledger.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_ledger.origins ENABLE ROW LEVEL SECURITY;
-- Only the offline fixture verifier may submit these already-verified facts.
-- Direct clients cannot mark a request verified. The owner seeds immutable order facts.
CREATE FUNCTION lab_ledger.apply_verified(e text,o text,k text,u text,i text,r text,a integer,c text, refund integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE ord lab_ledger.orders; prior lab_ledger.audit; target text; changed boolean; at_time timestamptz;
BEGIN
 SELECT * INTO STRICT ord FROM lab_ledger.orders WHERE id=o FOR UPDATE;
 IF ROW(u,i,r,a,c) IS DISTINCT FROM ROW(ord.uid,ord.item,ord.ref,ord.amount,ord.currency)
 THEN RAISE EXCEPTION 'fixture facts mismatch'; END IF;
 IF k IS NULL OR k NOT IN ('settled','refunded') THEN RAISE EXCEPTION 'invalid action'; END IF;
 IF (k='refunded' AND refund IS DISTINCT FROM ord.amount) OR (k='settled' AND refund IS NOT NULL)
 THEN RAISE EXCEPTION 'invalid fixture refund amount'; END IF;
 SELECT * INTO prior FROM lab_ledger.audit WHERE event=e;
 IF FOUND THEN
  IF (prior.order_id,prior.action) IS DISTINCT FROM (o,k) THEN RAISE EXCEPTION 'event conflict'; END IF;
  RETURN 'duplicate';
 END IF;
 IF k='settled' AND ord.status='refunded' THEN RAISE EXCEPTION 'refunded order'; END IF;
 target:=CASE k WHEN 'settled' THEN 'paid' ELSE 'refunded' END;
 changed:=ord.status<>target;
 at_time:=clock_timestamp();
 INSERT INTO lab_ledger.audit VALUES(e,o,k,ord.amount,refund,changed,at_time,session_user);
 IF NOT changed THEN RETURN 'duplicate'; END IF;
 UPDATE lab_ledger.orders SET status=target WHERE id=o;
 IF target='paid' THEN
  INSERT INTO lab_ledger.origins VALUES(o,e,NULL,at_time,at_time+interval '24 hours');
 ELSIF ord.status='paid' THEN
  UPDATE lab_ledger.origins SET refund_event=e WHERE order_id=o AND refund_event IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing origin'; END IF;
 END IF;
 RETURN target;
END $fn$;
-- A separate trusted synthetic reader sees decisions, not orders or receipts.
CREATE FUNCTION lab_ledger.snapshot_fixture(target_uid text)
RETURNS TABLE(shield boolean,double_win boolean) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $read$
BEGIN
 IF target_uid IS NULL OR target_uid !~ '^lab-uid-[a-z0-9]+$' OR length(target_uid)>96
 THEN RAISE EXCEPTION 'invalid fixture uid'; END IF;
 RETURN QUERY WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS at)
  SELECT bool_or(o.item='shield') IS TRUE, bool_or(o.item='double_win') IS TRUE
  FROM lab_ledger.orders o JOIN lab_ledger.origins g ON o.id=g.order_id
  CROSS JOIN sampled s WHERE o.uid=target_uid AND o.status='paid'
  AND g.refund_event IS NULL AND g.starts_at<=s.at AND s.at<g.expires_at;
END $read$;
-- Trusted synthetic verification runs upstream. The caller supplies the entire
-- verified tuple. Use a fresh lookup-only session and BEGIN READ ONLY.
CREATE FUNCTION lab_ledger.reconcile_verified(e text,o text,k text,u text,i text,r text,a integer,c text,refund integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $lookup$
DECLARE answer text;
BEGIN
 IF session_user <> 'lab_receipt_lookup' OR current_setting('transaction_read_only') <> 'on'
    OR current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'fresh read-only fixture lookup required';
 END IF;
 IF e IS NULL OR e !~ '^lab-event-[a-z0-9]+$' OR o IS NULL OR o !~ '^lab-order-[a-z0-9]+$'
    OR u IS NULL OR u !~ '^lab-uid-[a-z0-9]+$' OR r IS NULL OR r !~ '^lab-ref-[a-z0-9]+$'
    OR k IS NULL OR k NOT IN ('settled','refunded') OR i IS NULL OR i NOT IN ('shield','double_win')
    OR a IS NULL OR a<=0 OR c IS DISTINCT FROM 'THB' THEN
  RAISE EXCEPTION 'invalid synthetic lookup facts';
 END IF;
 SELECT CASE WHEN ROW(h.order_id,h.action,h.amount_minor,h.refund_minor,
                      ord.uid,ord.item,ord.ref,ord.amount,ord.currency)
                IS NOT DISTINCT FROM ROW(o,k,a,refund,u,i,r,a,c)
             THEN 'committed_exact' ELSE 'conflict' END INTO answer
 FROM lab_ledger.audit h JOIN lab_ledger.orders ord ON ord.id=h.order_id
 WHERE h.event=e;
 RETURN coalesce(answer,'absent_unknown');
END $lookup$;
REVOKE ALL ON ALL TABLES IN SCHEMA lab_ledger FROM PUBLIC,lab_verified_fixture,lab_item_snapshot_fixture,lab_receipt_lookup;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lab_ledger FROM PUBLIC;
GRANT USAGE ON SCHEMA lab_ledger TO lab_verified_fixture,lab_item_snapshot_fixture;
GRANT EXECUTE ON FUNCTION lab_ledger.apply_verified(text,text,text,text,text,text,integer,text,integer) TO lab_verified_fixture;
GRANT EXECUTE ON FUNCTION lab_ledger.snapshot_fixture(text) TO lab_item_snapshot_fixture;
GRANT USAGE ON SCHEMA lab_ledger TO lab_receipt_lookup;
GRANT EXECUTE ON FUNCTION lab_ledger.reconcile_verified(text,text,text,text,text,text,integer,text,integer)
 TO lab_receipt_lookup;
COMMIT;
