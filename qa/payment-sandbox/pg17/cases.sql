INSERT INTO lab_ledger.orders(id,uid,item,ref,amount,currency)
SELECT 'lab-order-'||n,'lab-uid-a',CASE WHEN n=3 THEN 'double_win' ELSE 'shield' END,
 'lab-ref-'||n,123,'THB' FROM generate_series(1,4) n;
CREATE ROLE lab_untrusted NOLOGIN;
-- Test-only invoker supplies consistent synthetic fixture facts; has no elevated privileges.
CREATE FUNCTION public.fixture(e text,n int,k text) RETURNS text LANGUAGE sql AS $$
 SELECT lab_ledger.apply_verified('lab-event-'||e,'lab-order-'||n,k,'lab-uid-a',
 CASE WHEN n=3 THEN 'double_win' ELSE 'shield' END,'lab-ref-'||n,123,'THB',CASE WHEN k='refunded' THEN 123 END)
$$;
CREATE FUNCTION public.reject_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected origin write failure'; END $$;
CREATE TRIGGER fail_origin BEFORE INSERT OR UPDATE ON lab_ledger.origins
 FOR EACH ROW EXECUTE FUNCTION public.reject_origin();
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
DO $$ BEGIN
 BEGIN PERFORM public.fixture('a',1,'settled'); RAISE EXCEPTION 'unexpected success';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected origin write failure' THEN RAISE; END IF; END;
END $$;
-- next backend
DO $$ BEGIN
 IF EXISTS(SELECT FROM lab_ledger.audit) OR EXISTS(SELECT FROM lab_ledger.origins)
 OR EXISTS(SELECT FROM lab_ledger.orders WHERE status<>'pending') THEN RAISE EXCEPTION 'partial settlement'; END IF;
END $$;
ALTER TABLE lab_ledger.origins DISABLE TRIGGER fail_origin;
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
BEGIN;
SELECT public.fixture('outer',1,'settled');
ROLLBACK;
-- next backend
DO $$ BEGIN IF EXISTS(SELECT FROM lab_ledger.audit) OR EXISTS(SELECT FROM lab_ledger.origins)
 OR EXISTS(SELECT FROM lab_ledger.orders WHERE status<>'pending') THEN RAISE EXCEPTION 'outer rollback'; END IF; END $$;
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
DO $$ BEGIN
 IF public.fixture('a',1,'settled') <> 'paid' THEN RAISE EXCEPTION 'first'; END IF;
 IF public.fixture('a',1,'settled') <> 'duplicate' THEN RAISE EXCEPTION 'retry'; END IF;
 IF public.fixture('b',1,'settled') <> 'duplicate' THEN RAISE EXCEPTION 'no-op'; END IF;
 IF public.fixture('c',2,'settled') <> 'paid' THEN RAISE EXCEPTION 'second shield'; END IF;
 IF public.fixture('d',3,'settled') <> 'paid' THEN RAISE EXCEPTION 'x2'; END IF;
 BEGIN PERFORM public.fixture('a',2,'settled'); RAISE EXCEPTION 'reused event';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'event conflict' THEN RAISE; END IF; END;
 BEGIN PERFORM public.fixture('a',1,'refunded'); RAISE EXCEPTION 'changed action';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'event conflict' THEN RAISE; END IF; END;
 BEGIN PERFORM lab_ledger.apply_verified('lab-event-e','lab-order-1','refunded','lab-uid-a','shield','lab-ref-1',122,'THB',123);
 RAISE EXCEPTION 'wrong amount accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'fixture facts mismatch' THEN RAISE; END IF; END;
 BEGIN PERFORM lab_ledger.apply_verified('lab-event-e','lab-order-1','refunded','lab-uid-a','shield','lab-ref-1',123,'THB',122);
 RAISE EXCEPTION 'partial refund accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid fixture refund amount' THEN RAISE; END IF; END;
 BEGIN PERFORM lab_ledger.apply_verified('lab-event-e','lab-order-1','refunded','lab-uid-a','shield','lab-ref-1',123,'THB',NULL);
 RAISE EXCEPTION 'unverified refund accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid fixture refund amount' THEN RAISE; END IF; END;
 BEGIN PERFORM lab_ledger.snapshot_fixture('lab-uid-a'); RAISE EXCEPTION 'writer reading snapshot';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT row_security_active('lab_ledger.orders') THEN RAISE EXCEPTION 'fixture bypasses RLS'; END IF;
 BEGIN UPDATE lab_ledger.orders SET status='refunded'; RAISE EXCEPTION 'direct write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM lab_ledger.audit; RAISE EXCEPTION 'direct audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- next backend
ALTER TABLE lab_ledger.origins ENABLE TRIGGER fail_origin;
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
DO $$ BEGIN
 BEGIN PERFORM public.fixture('r',1,'refunded'); RAISE EXCEPTION 'unexpected refund';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected origin write failure' THEN RAISE; END IF; END;
END $$;
-- next backend
DO $$ BEGIN IF EXISTS(SELECT FROM lab_ledger.audit WHERE event='lab-event-r')
 OR EXISTS(SELECT FROM lab_ledger.origins WHERE refund_event IS NOT NULL)
 OR (SELECT status FROM lab_ledger.orders WHERE id='lab-order-1')<>'paid' THEN RAISE EXCEPTION 'partial refund'; END IF; END $$;
ALTER TABLE lab_ledger.origins DISABLE TRIGGER fail_origin;
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
DO $$ BEGIN
 IF public.fixture('r',1,'refunded')<>'refunded' THEN RAISE EXCEPTION 'refund'; END IF;
 IF public.fixture('r',1,'refunded')<>'duplicate' THEN RAISE EXCEPTION 'refund retry'; END IF;
 IF public.fixture('t',4,'refunded')<>'refunded' THEN RAISE EXCEPTION 'pending refund'; END IF;
 BEGIN PERFORM public.fixture('late',4,'settled'); RAISE EXCEPTION 'late payment';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'refunded order' THEN RAISE; END IF; END;
END $$;
-- next backend
SET SESSION AUTHORIZATION lab_untrusted;
DO $$ BEGIN
 BEGIN PERFORM public.fixture('outsider',2,'refunded'); RAISE EXCEPTION 'untrusted call';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- next backend
DO $$ DECLARE observed text[]; BEGIN
 SELECT array_agg(o.item ORDER BY o.item) INTO observed FROM lab_ledger.orders o
 JOIN lab_ledger.origins g ON o.id=g.order_id WHERE o.uid='lab-uid-a' AND o.status='paid'
 AND g.refund_event IS NULL AND g.starts_at<=statement_timestamp() AND statement_timestamp()<g.expires_at;
 IF observed IS DISTINCT FROM ARRAY['double_win','shield'] OR (SELECT count(*) FROM lab_ledger.origins)<>3
 OR (SELECT count(*) FROM lab_ledger.audit)<>6
 OR EXISTS(SELECT FROM lab_ledger.audit WHERE actor<>'lab_verified_fixture')
 OR NOT EXISTS(SELECT FROM lab_ledger.audit WHERE event='lab-event-b' AND NOT applied)
 OR NOT EXISTS(SELECT FROM lab_ledger.audit WHERE event='lab-event-r' AND amount_minor=123 AND refund_minor=123)
 OR NOT EXISTS(SELECT FROM lab_ledger.origins WHERE order_id='lab-order-1' AND issue_event='lab-event-a' AND refund_event='lab-event-r')
 OR EXISTS(SELECT FROM lab_ledger.origins g JOIN lab_ledger.audit a ON a.event=g.issue_event
 WHERE g.starts_at<>a.accepted_at OR g.expires_at-g.starts_at<>interval '24 hours')
 THEN RAISE EXCEPTION 'durable attribution'; END IF;
END $$;
-- next backend
SET SESSION AUTHORIZATION lab_item_snapshot_fixture;
DO $$ DECLARE s record; BEGIN
 SELECT * INTO STRICT s FROM lab_ledger.snapshot_fixture('lab-uid-a');
 IF (s.shield,s.double_win) IS DISTINCT FROM (true,true) THEN RAISE EXCEPTION 'wrong item snapshot'; END IF;
 SELECT * INTO STRICT s FROM lab_ledger.snapshot_fixture('lab-uid-unbought');
 IF (s.shield,s.double_win) IS DISTINCT FROM (false,false) THEN RAISE EXCEPTION 'foreign item snapshot'; END IF;
 BEGIN PERFORM lab_ledger.snapshot_fixture('actual-uid'); RAISE EXCEPTION 'invalid UID accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid fixture uid' THEN RAISE; END IF; END;
 BEGIN PERFORM public.fixture('reader',2,'refunded'); RAISE EXCEPTION 'reader can write';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM event FROM lab_ledger.audit; RAISE EXCEPTION 'reader sees history';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- next backend
SET SESSION AUTHORIZATION lab_verified_fixture;
BEGIN;
SELECT public.fixture('refundrolledback',2,'refunded');
ROLLBACK;
-- next backend
SET SESSION AUTHORIZATION lab_receipt_lookup;
DO $$ BEGIN
 BEGIN PERFORM lab_ledger.reconcile_verified('lab-event-r','lab-order-1','refunded','lab-uid-a','shield','lab-ref-1',123,'THB',123);
 RAISE EXCEPTION 'writable transaction accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'fresh read-only fixture lookup required' THEN RAISE; END IF; END;
 BEGIN PERFORM event FROM lab_ledger.audit; RAISE EXCEPTION 'raw audit readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.fixture('forbidden',2,'refunded'); RAISE EXCEPTION 'lookup can settle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- next backend
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL SESSION AUTHORIZATION lab_receipt_lookup;
DO $$ DECLARE v record; result text; BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('a','1','settled',123,NULL::integer,'committed_exact'),
  ('b','1','settled',123,NULL,'committed_exact'), -- previously recorded no-op
  ('r','1','refunded',123,123,'committed_exact'),
  ('r','1','refunded',123,122,'conflict'),
  ('r','1','refunded',123,NULL,'conflict'),
  ('r','1','refunded',122,122,'conflict'),
  ('r','1','settled',123,NULL,'conflict'),
  ('a','2','settled',123,NULL,'conflict'),
  ('outer','1','settled',123,NULL,'absent_unknown'),
  ('refundrolledback','2','refunded',123,123,'absent_unknown')
 ) x(event,ord,action,amount,refund,expected) LOOP
  result:=lab_ledger.reconcile_verified('lab-event-'||v.event,'lab-order-'||v.ord,v.action,
    'lab-uid-a','shield','lab-ref-'||v.ord,v.amount,'THB',v.refund);
  IF result IS DISTINCT FROM v.expected THEN RAISE EXCEPTION 'lookup case % expected %, got %',v.event,v.expected,result; END IF;
 END LOOP;
 IF lab_ledger.reconcile_verified('lab-event-a','lab-order-1','settled','lab-uid-other','shield','lab-ref-1',123,'THB',NULL)
  IS DISTINCT FROM 'conflict' THEN RAISE EXCEPTION 'UID not bound'; END IF;
END $$;
COMMIT;
-- next backend
BEGIN READ ONLY;
SET LOCAL SESSION AUTHORIZATION lab_item_snapshot_fixture;
DO $$ BEGIN
 BEGIN PERFORM lab_ledger.reconcile_verified('lab-event-a','lab-order-1','settled','lab-uid-a','shield','lab-ref-1',123,'THB',NULL);
 RAISE EXCEPTION 'snapshot role can reconcile';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
-- next backend
DO $$ BEGIN
 IF (SELECT count(*) FROM lab_ledger.audit)<>6 OR (SELECT count(*) FROM lab_ledger.origins)<>3
 OR (SELECT status FROM lab_ledger.orders WHERE id='lab-order-2')<>'paid'
 THEN RAISE EXCEPTION 'post-lookup footprint'; END IF;
END $$;
SELECT 'LEDGER_CHECKS_PASSED';
