-- Mots du Jour : un mot par jour, français <-> chinois, pour Matis et Stella.
-- Tout vit dans le schéma mdj (le projet Supabase est partagé avec Tâches Famille).
create schema if not exists mdj;
grant usage on schema mdj to anon, authenticated, service_role;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Les deux personnes. learns = la langue que la personne apprend.
create table if not exists mdj.people (
  id text primary key check (id in ('matis','stella')),
  name text not null,
  learns text not null check (learns in ('fr','zh')),
  lang text not null default 'fr' check (lang in ('fr','zh')),
  tz text not null,
  deliver_hour int not null default 8,
  remind_hour int not null default 20
);
insert into mdj.people (id, name, learns, lang, tz) values
  ('matis', 'Matis', 'zh', 'fr', 'Europe/Paris'),
  ('stella', 'Stella', 'fr', 'zh', 'Asia/Shanghai')
on conflict (id) do nothing;

-- Code du couple (vérifié côté serveur, jamais lu par l'appli)
create table if not exists mdj.app_config (key text primary key, value text not null);

-- Appareil (utilisateur anonyme Supabase) -> personne
create table if not exists mdj.devices (
  auth_uid uuid primary key,
  person_id text not null references mdj.people(id),
  created_at timestamptz not null default now()
);

create table if not exists mdj.words (
  id text primary key,
  fr text not null,
  zh text not null,
  pinyin text not null,
  en text not null,
  kind text not null check (kind in ('word','phrase','rude')),
  theme text not null
);

-- Une "manche" = un mot livré à un apprenant à deliver_at (8h chez lui), choisi par l'autre avant.
create table if not exists mdj.rounds (
  id uuid primary key default gen_random_uuid(),
  learner text not null references mdj.people(id),
  deliver_at timestamptz not null,
  proposals text[] not null,
  rerolled boolean not null default false,
  chosen text references mdj.words(id),
  chosen_by text,
  chosen_at timestamptz,
  delivered_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (learner, deliver_at)
);
create index if not exists rounds_learner_open on mdj.rounds (learner) where delivered_at is null;

create table if not exists mdj.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id text not null references mdj.people(id),
  auth_uid uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists mdj.notifications_log (
  id bigserial primary key,
  person_id text,
  kind text,
  title text,
  body text,
  sent int,
  created_at timestamptz not null default now()
);

-- Helpers ------------------------------------------------------------------
create or replace function mdj.current_person_id() returns text
language sql stable security definer set search_path = mdj, public as $$
  select person_id from mdj.devices where auth_uid = auth.uid()
$$;

create or replace function mdj.is_member() returns boolean
language sql stable security definer set search_path = mdj, public as $$
  select exists (select 1 from mdj.devices where auth_uid = auth.uid())
$$;

create or replace function mdj.partner_of(p text) returns text
language sql immutable as $$ select case when p = 'matis' then 'stella' else 'matis' end $$;

-- Prochaine livraison pour un apprenant : prochain "deliver_hour" dans son fuseau, après "from_ts".
create or replace function mdj.next_delivery(p_learner text, from_ts timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  p mdj.people%rowtype;
  local_now timestamp;
  cand timestamp;
begin
  select * into p from mdj.people where id = p_learner;
  local_now := from_ts at time zone p.tz;
  cand := date_trunc('day', local_now) + make_interval(hours => p.deliver_hour);
  if cand <= local_now then cand := cand + interval '1 day'; end if;
  return cand at time zone p.tz;
end $$;

-- 3 mots au hasard jamais encore livrés/choisis pour cet apprenant (et hors "exclude").
create or replace function mdj.pick_words(p_learner text, p_exclude text[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(id), '{}') from (
    select w.id from mdj.words w
    where w.id <> all (coalesce(p_exclude, '{}'))
      and not exists (select 1 from mdj.rounds r where r.learner = p_learner and r.chosen = w.id)
    order by random() limit 3
  ) s
$$;

-- Garantit qu'il existe une manche ouverte (non livrée) pour l'apprenant.
create or replace function mdj.ensure_open_round(p_learner text) returns mdj.rounds
language plpgsql security definer set search_path = mdj, public as $$
declare
  r mdj.rounds%rowtype;
  last_deliver timestamptz;
  d timestamptz;
begin
  select * into r from mdj.rounds where learner = p_learner and delivered_at is null
    order by deliver_at limit 1;
  if found then return r; end if;
  select max(deliver_at) into last_deliver from mdj.rounds where learner = p_learner;
  d := mdj.next_delivery(p_learner, greatest(now(), coalesce(last_deliver, now())));
  insert into mdj.rounds (learner, deliver_at, proposals)
    values (p_learner, d, mdj.pick_words(p_learner, '{}'))
  returning * into r;
  return r;
end $$;

-- RLS ------------------------------------------------------------------------
alter table mdj.people enable row level security;
alter table mdj.app_config enable row level security;
alter table mdj.devices enable row level security;
alter table mdj.words enable row level security;
alter table mdj.rounds enable row level security;
alter table mdj.push_subscriptions enable row level security;
alter table mdj.notifications_log enable row level security;

create policy "people read members" on mdj.people for select to authenticated using (mdj.is_member());
create policy "words read members" on mdj.words for select to authenticated using (mdj.is_member());
-- On ne peut pas lire une manche non livrée dont on est l'apprenant (pas de triche sur le mot de demain).
create policy "rounds read members" on mdj.rounds for select to authenticated
  using (mdj.is_member() and (delivered_at is not null or learner <> mdj.current_person_id()));
create policy "devices read own" on mdj.devices for select to authenticated using (auth_uid = auth.uid());
create policy "subs read own" on mdj.push_subscriptions for select to authenticated using (auth_uid = auth.uid());
create policy "subs insert own" on mdj.push_subscriptions for insert to authenticated
  with check (auth_uid = auth.uid() and person_id = mdj.current_person_id());
create policy "subs delete own" on mdj.push_subscriptions for delete to authenticated using (auth_uid = auth.uid());

-- RPC -------------------------------------------------------------------------
create or replace function mdj.join_couple(p_code text, p_person text) returns mdj.people
language plpgsql security definer set search_path = mdj, public as $$
declare
  real_code text;
  p mdj.people%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select value into real_code from mdj.app_config where key = 'couple_code';
  if real_code is null or real_code <> p_code then
    perform pg_sleep(1);
    raise exception 'bad_code';
  end if;
  if p_person not in ('matis','stella') then raise exception 'bad_person'; end if;
  insert into mdj.devices (auth_uid, person_id) values (auth.uid(), p_person)
    on conflict (auth_uid) do update set person_id = excluded.person_id;
  select * into p from mdj.people where id = p_person;
  return p;
end $$;

create or replace function mdj.leave_couple() returns void
language plpgsql security definer set search_path = mdj, public as $$
begin
  delete from mdj.push_subscriptions where auth_uid = auth.uid();
  delete from mdj.devices where auth_uid = auth.uid();
end $$;

create or replace function mdj.set_lang(p_lang text) returns void
language plpgsql security definer set search_path = mdj, public as $$
begin
  if p_lang not in ('fr','zh') then raise exception 'bad_lang'; end if;
  update mdj.people set lang = p_lang where id = mdj.current_person_id();
end $$;

create or replace function mdj.word_json(w mdj.words) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', w.id, 'fr', w.fr, 'zh', w.zh, 'pinyin', w.pinyin, 'en', w.en, 'kind', w.kind, 'theme', w.theme)
$$;

-- Etat complet pour l'appli : moi, mon mot du jour, la manche à choisir pour l'autre.
create or replace function mdj.get_state() returns jsonb
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  other text;
  me_row mdj.people%rowtype;
  other_row mdj.people%rowtype;
  today_round mdj.rounds%rowtype;
  open_round mdj.rounds%rowtype;
  props jsonb;
  today_word jsonb;
begin
  if me is null then raise exception 'not_member'; end if;
  other := mdj.partner_of(me);
  select * into me_row from mdj.people where id = me;
  select * into other_row from mdj.people where id = other;

  -- Mon mot du jour = dernière manche livrée pour moi
  select * into today_round from mdj.rounds where learner = me and delivered_at is not null
    order by deliver_at desc limit 1;
  if found then
    select mdj.word_json(w) into today_word from mdj.words w where w.id = today_round.chosen;
  end if;

  -- La manche que je dois choisir pour l'autre
  open_round := mdj.ensure_open_round(other);
  select coalesce(jsonb_agg(mdj.word_json(w) order by array_position(open_round.proposals, w.id)), '[]')
    into props from mdj.words w where w.id = any (open_round.proposals);

  return jsonb_build_object(
    'me', jsonb_build_object('id', me_row.id, 'name', me_row.name, 'learns', me_row.learns, 'lang', me_row.lang, 'tz', me_row.tz,
                             'deliver_hour', me_row.deliver_hour, 'remind_hour', me_row.remind_hour),
    'partner', jsonb_build_object('id', other_row.id, 'name', other_row.name, 'learns', other_row.learns, 'tz', other_row.tz,
                                  'deliver_hour', other_row.deliver_hour),
    'today', case when today_word is null then null else jsonb_build_object(
        'round_id', today_round.id, 'word', today_word, 'deliver_at', today_round.deliver_at,
        'chosen_by', today_round.chosen_by, 'next_deliver_at', (select min(deliver_at) from mdj.rounds where learner = me and delivered_at is null)) end,
    'to_choose', jsonb_build_object('round_id', open_round.id, 'deliver_at', open_round.deliver_at, 'proposals', props,
                                    'rerolled', open_round.rerolled, 'chosen', open_round.chosen, 'chosen_by', open_round.chosen_by),
    'now', now()
  );
end $$;

create or replace function mdj.choose_word(p_round uuid, p_word text) returns jsonb
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  r mdj.rounds%rowtype;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into r from mdj.rounds where id = p_round for update;
  if not found or r.learner <> mdj.partner_of(me) then raise exception 'bad_round'; end if;
  if r.delivered_at is not null or now() >= r.deliver_at then raise exception 'too_late'; end if;
  if not (p_word = any (r.proposals)) then raise exception 'bad_word'; end if;
  update mdj.rounds set chosen = p_word, chosen_by = me, chosen_at = now() where id = p_round;
  return mdj.get_state();
end $$;

create or replace function mdj.reroll(p_round uuid) returns jsonb
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  r mdj.rounds%rowtype;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into r from mdj.rounds where id = p_round for update;
  if not found or r.learner <> mdj.partner_of(me) then raise exception 'bad_round'; end if;
  if r.delivered_at is not null or now() >= r.deliver_at then raise exception 'too_late'; end if;
  if r.rerolled then raise exception 'already_rerolled'; end if;
  if r.chosen is not null then raise exception 'already_chosen'; end if;
  update mdj.rounds set proposals = mdj.pick_words(r.learner, r.proposals), rerolled = true where id = p_round;
  return mdj.get_state();
end $$;

-- Historique : mots livrés (pour moi et pour l'autre), du plus récent au plus ancien.
create or replace function mdj.history() returns jsonb
language sql security definer set search_path = mdj, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'round_id', r.id, 'learner', r.learner, 'deliver_at', r.deliver_at, 'chosen_by', r.chosen_by, 'word', mdj.word_json(w))
      order by r.deliver_at desc), '[]')
  from mdj.rounds r join mdj.words w on w.id = r.chosen
  where r.delivered_at is not null and mdj.is_member()
$$;

grant execute on function mdj.join_couple(text, text) to authenticated;
grant execute on function mdj.leave_couple() to authenticated;
grant execute on function mdj.set_lang(text) to authenticated;
grant execute on function mdj.get_state() to authenticated;
grant execute on function mdj.choose_word(uuid, text) to authenticated;
grant execute on function mdj.reroll(uuid) to authenticated;
grant execute on function mdj.history() to authenticated;
revoke execute on function mdj.ensure_open_round(text) from public, anon, authenticated;
revoke execute on function mdj.pick_words(text, text[]) from public, anon, authenticated;

-- Fonction appelée par la fonction serveur (service_role) : livre les manches arrivées à échéance.
-- Retourne les manches livrées à l'instant (pour envoyer les notifications).
create or replace function mdj.deliver_due() returns setof mdj.rounds
language plpgsql security definer set search_path = mdj, public as $$
declare
  r mdj.rounds%rowtype;
  pick text;
begin
  for r in select * from mdj.rounds where delivered_at is null and deliver_at <= now() for update loop
    if r.chosen is null then
      pick := r.proposals[1 + floor(random() * array_length(r.proposals, 1))::int];
      update mdj.rounds set chosen = pick, chosen_by = 'auto', chosen_at = now(), delivered_at = now()
        where id = r.id returning * into r;
    else
      update mdj.rounds set delivered_at = now() where id = r.id returning * into r;
    end if;
    return next r;
    perform mdj.ensure_open_round(r.learner);
  end loop;
  return;
end $$;
revoke execute on function mdj.deliver_due() from public, anon, authenticated;
grant execute on function mdj.deliver_due() to service_role;

-- Droits sur les tables (les règles RLS ci-dessus limitent ce que chacun voit)
grant all on all tables in schema mdj to service_role;
alter default privileges in schema mdj grant all on tables to service_role;
alter default privileges in schema mdj grant all on sequences to service_role;
grant select on all tables in schema mdj to authenticated;
alter default privileges in schema mdj grant select on tables to authenticated;
grant insert, update, delete on mdj.push_subscriptions to authenticated;
