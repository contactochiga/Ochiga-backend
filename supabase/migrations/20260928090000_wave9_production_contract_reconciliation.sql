-- Wave 9 forward reconciliation of verified production contracts.
--
-- This migration does not rewrite any historical migration or claim to be the
-- original creator of these relations.  It makes the live Core contracts safe
-- on a production database that predates their tracked definitions.
begin;
set local lock_timeout = '5s';

-- Core persists semantic confidence, a typed source-event list and an evidence
-- list.  Older production installations used numeric/jsonb/object forms.
-- Refuse lossy conversion rather than guessing about a populated legacy row.
do $$
declare
  confidence_type text;
  source_type text;
  invalid_source bigint;
  invalid_evidence bigint;
begin
  if to_regclass('public.ochiga_intelligence_predictions') is null then
    raise exception 'ochiga_intelligence_predictions is required before Wave 9 reconciliation';
  end if;

  select format_type(a.atttypid, a.atttypmod) into confidence_type
  from pg_attribute a
  where a.attrelid = 'public.ochiga_intelligence_predictions'::regclass
    and a.attname = 'confidence' and not a.attisdropped;
  if confidence_type not in ('text', 'numeric(5,2)', 'numeric') then
    raise exception 'unsupported ochiga_intelligence_predictions.confidence type: %', confidence_type;
  end if;

  select format_type(a.atttypid, a.atttypmod) into source_type
  from pg_attribute a
  where a.attrelid = 'public.ochiga_intelligence_predictions'::regclass
    and a.attname = 'source_event_ids' and not a.attisdropped;
  if source_type not in ('text[]', 'jsonb') then
    raise exception 'unsupported ochiga_intelligence_predictions.source_event_ids type: %', source_type;
  end if;

  if source_type = 'jsonb' then
    select count(*) into invalid_source
    from public.ochiga_intelligence_predictions p
    where p.source_event_ids is not null
      and (jsonb_typeof(p.source_event_ids) <> 'array'
        or exists (
          select 1 from jsonb_array_elements(p.source_event_ids) value
          where jsonb_typeof(value) <> 'string'
        ));
    if invalid_source > 0 then
      raise exception 'refusing lossy source_event_ids conversion: % invalid legacy rows', invalid_source;
    end if;
  end if;

  select count(*) into invalid_evidence
  from public.ochiga_intelligence_predictions p
  where p.evidence is not null and jsonb_typeof(p.evidence) not in ('array', 'object');
  if invalid_evidence > 0 then
    raise exception 'refusing lossy evidence conversion: % invalid legacy rows', invalid_evidence;
  end if;
end $$;

do $$
declare
  confidence_type text;
  source_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into confidence_type
  from pg_attribute a
  where a.attrelid = 'public.ochiga_intelligence_predictions'::regclass
    and a.attname = 'confidence' and not a.attisdropped;
  if confidence_type in ('numeric(5,2)', 'numeric') then
    alter table public.ochiga_intelligence_predictions alter column confidence drop default;
    alter table public.ochiga_intelligence_predictions alter column confidence type text using
      case
        when confidence >= 0.85 then 'confirmed'
        when confidence >= 0.65 then 'likely'
        when confidence >= 0.35 then 'possible'
        else 'needs_monitoring'
      end;
  end if;

  select format_type(a.atttypid, a.atttypmod) into source_type
  from pg_attribute a
  where a.attrelid = 'public.ochiga_intelligence_predictions'::regclass
    and a.attname = 'source_event_ids' and not a.attisdropped;
  if source_type = 'jsonb' then
    alter table public.ochiga_intelligence_predictions add column source_event_ids_wave9 text[];
    update public.ochiga_intelligence_predictions p
      set source_event_ids_wave9 = coalesce((
        select array_agg(value order by ordinality)
        from jsonb_array_elements_text(p.source_event_ids) with ordinality as source(value, ordinality)
      ), '{}'::text[]);
    alter table public.ochiga_intelligence_predictions drop column source_event_ids;
    alter table public.ochiga_intelligence_predictions rename column source_event_ids_wave9 to source_event_ids;
  end if;
end $$;

update public.ochiga_intelligence_predictions
  set confidence = 'possible'
  where confidence is null or confidence not in ('confirmed', 'likely', 'possible', 'needs_monitoring');
update public.ochiga_intelligence_predictions
  set source_event_ids = '{}'::text[]
  where source_event_ids is null;
update public.ochiga_intelligence_predictions
  set evidence = case when jsonb_typeof(evidence) = 'object' then jsonb_build_array(evidence) else evidence end;
update public.ochiga_intelligence_predictions
  set evidence = '[]'::jsonb
  where evidence is null;
alter table public.ochiga_intelligence_predictions
  alter column confidence set default 'possible',
  alter column confidence set not null,
  alter column source_event_ids set default '{}'::text[],
  alter column source_event_ids set not null,
  alter column evidence set default '[]'::jsonb,
  alter column evidence set not null;

-- Facility discovery can truthfully report a camera before IP or RTSP evidence
-- exists.  The authoritative camera observation contract permits that state.
alter table public.facility_cameras
  alter column ip drop not null,
  alter column rtsp_url drop not null;

-- Facility creation already writes this repository contract.  Additive/default
-- only: existing production homes remain valid as the default home type.
alter table public.homes
  add column if not exists type text default 'home';

commit;
