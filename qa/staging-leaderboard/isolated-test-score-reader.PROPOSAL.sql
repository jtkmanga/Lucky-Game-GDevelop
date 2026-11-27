-- Isolated synthetic PostgreSQL QA only. Not a live migration.
-- Never install against a shared/unknown or production database. The
-- registry is written by the isolated test operator, not the runtime/reader.
BEGIN;
CREATE ROLE lucky_qa_rank_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
CREATE ROLE lucky_qa_rank_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
CREATE SCHEMA lucky_rank_qa;
REVOKE ALL ON SCHEMA lucky_rank_qa FROM PUBLIC;
CREATE TABLE lucky_rank_qa.allowed_score_pairs (
  game_id uuid NOT NULL REFERENCES game.rooms(room_id),
  scorer_uid uuid NOT NULL REFERENCES game.players(uid),
  mode text NOT NULL CHECK (mode IN ('free', 'vip')),
  PRIMARY KEY (game_id, scorer_uid)
);
REVOKE ALL ON lucky_rank_qa.allowed_score_pairs FROM PUBLIC;
GRANT USAGE ON SCHEMA game TO lucky_qa_rank_owner;
GRANT USAGE ON SCHEMA lucky_rank_qa TO lucky_qa_rank_owner, lucky_qa_rank_reader;
GRANT SELECT (game_id, scorer_uid, mode) ON lucky_rank_qa.allowed_score_pairs TO lucky_qa_rank_owner;
GRANT SELECT (game_id, uid, mode, created_at, points) ON game.score_events TO lucky_qa_rank_owner;
CREATE POLICY lucky_rank_qa_scoped_scores ON game.score_events
  FOR SELECT TO lucky_qa_rank_owner
  USING (EXISTS (
    SELECT 1 FROM lucky_rank_qa.allowed_score_pairs p
    WHERE (p.game_id, p.scorer_uid, p.mode) = (score_events.game_id, score_events.uid, score_events.mode)
  ));

CREATE FUNCTION lucky_rank_qa.read_current(mode_name text, start_ms bigint, end_ms bigint, max_rows integer)
RETURNS TABLE(score bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $read$
BEGIN
  IF SESSION_USER <> 'lucky_qa_rank_reader'
    OR mode_name IS NULL OR mode_name NOT IN ('free','vip')
    OR start_ms IS NULL OR end_ms IS NULL OR start_ms >= end_ms
    OR max_rows IS NULL OR max_rows NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'Invalid isolated leaderboard read' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT sum(e.points)::bigint AS total
    FROM lucky_rank_qa.allowed_score_pairs p
    JOIN game.score_events e ON (p.game_id, p.scorer_uid, p.mode) = (e.game_id, e.uid, e.mode)
    WHERE e.mode = mode_name
      AND e.created_at >= to_timestamp(start_ms::double precision / 1000)
      AND e.created_at < to_timestamp(end_ms::double precision / 1000)
    GROUP BY e.uid
    ORDER BY total DESC, e.uid
    LIMIT max_rows;
END;
$read$;
ALTER FUNCTION lucky_rank_qa.read_current(text,bigint,bigint,integer) OWNER TO lucky_qa_rank_owner;
REVOKE ALL ON FUNCTION lucky_rank_qa.read_current(text,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lucky_rank_qa.read_current(text,bigint,bigint,integer) TO lucky_qa_rank_reader;
COMMIT;
