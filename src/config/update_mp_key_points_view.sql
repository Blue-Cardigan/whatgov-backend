-- Drop existing objects first
DROP TRIGGER IF EXISTS refresh_mp_key_points_trigger ON public.debates;
DROP FUNCTION IF EXISTS public.refresh_mp_key_points();
DROP MATERIALIZED VIEW IF EXISTS public.mp_key_points;

-- Create materialized view with a unique index (required for concurrent refresh)
CREATE MATERIALIZED VIEW public.mp_key_points AS
SELECT DISTINCT ON (d.id)
  d.id as debate_id,
  d.ext_id as debate_ext_id,
  d.title as debate_title,
  d.date as debate_date,
  d.type as debate_type,
  d.house as debate_house,
  d.location as debate_location,
  d.parent_ext_id,
  d.parent_title,
  d.ai_key_points as all_key_points,
  kp->>'point' as point,
  kp->>'context' as context,
  kp->'speaker'->>'memberId' as member_id,
  m.display_as as speaker_name,
  m.party as speaker_party,
  m.constituency as speaker_constituency,
  m.house as speaker_house,
  m.twfy_image_url as speaker_image_url,
  m.full_title as speaker_full_title,
  kp->'support' as support,
  kp->'opposition' as opposition,
  d.ai_topics,
  d.ai_summary,
  d.interest_score
FROM 
  public.debates d
  CROSS JOIN LATERAL jsonb_array_elements(d.ai_key_points) as kp
  LEFT JOIN public.members m ON 
    CASE 
      WHEN kp->'speaker'->>'memberId' ~ '^[0-9]+$' 
      THEN (kp->'speaker'->>'memberId')::integer 
    END = m.member_id
WHERE 
  kp->'speaker'->>'memberId' IS NOT NULL
  AND kp->'speaker'->>'memberId' != 'N/A'
ORDER BY 
  d.id, d.date DESC;

-- Set ownership and permissions immediately
ALTER MATERIALIZED VIEW public.mp_key_points OWNER TO postgres;

-- Create unique index (required for concurrent refresh)
CREATE UNIQUE INDEX idx_mp_key_points_unique ON public.mp_key_points(debate_id);

-- Add other indexes
CREATE INDEX idx_mp_key_points_member_id ON public.mp_key_points(member_id);
CREATE INDEX idx_mp_key_points_date ON public.mp_key_points(debate_date DESC);

-- Create the function with security definer
CREATE OR REPLACE FUNCTION public.refresh_mp_key_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Attempt concurrent refresh, fall back to regular refresh if it fails
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.mp_key_points;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Concurrent refresh failed, falling back to regular refresh: %', SQLERRM;
        REFRESH MATERIALIZED VIEW public.mp_key_points;
    END;
    RETURN NULL;
END;
$$;

-- Set function ownership
ALTER FUNCTION public.refresh_mp_key_points() OWNER TO postgres;

-- Create the trigger
CREATE TRIGGER refresh_mp_key_points_trigger
    AFTER INSERT OR UPDATE OR DELETE
    ON public.debates
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.refresh_mp_key_points();

-- Grant permissions
GRANT SELECT ON public.mp_key_points TO authenticated;
GRANT SELECT ON public.mp_key_points TO anon;
GRANT SELECT ON public.mp_key_points TO service_role;