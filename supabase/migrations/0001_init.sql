-- Mots du Jour : un mot par jour, français <-> chinois, pour Matis et Stella.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Les deux personnes. learns = la langue que la personne apprend.
create table if not exists public.people (
  id text primary key check (id in ('matis','stella')),
  name text not null,
  learns text not null check (learns in ('fr','zh')),
  lang text not null default 'fr' check (lang in ('fr','zh')),
  tz text not null,
  deliver_hour int not null default 8,
  remind_hour int not null default 20
);
insert into public.people (id, name, learns, lang, tz) values
  ('matis', 'Matis', 'zh', 'fr', 'Europe/Paris'),
  ('stella', 'Stella', 'fr', 'zh', 'Asia/Shanghai')
on conflict (id) do nothing;

-- Code du couple (vérifié côté serveur, jamais lu par l'appli)
create table if not exists public.app_config (key text primary key, value text not null);

-- Appareil (utilisateur anonyme Supabase) -> personne
create table if not exists public.devices (
  auth_uid uuid primary key,
  person_id text not null references public.people(id),
  created_at timestamptz not null default now()
);

create table if not exists public.words (
  id text primary key,
  fr text not null,
  zh text not null,
  pinyin text not null,
  en text not null,
  kind text not null check (kind in ('word','phrase','rude')),
  theme text not null
);

-- Une "manche" = un mot livré à un apprenant à deliver_at (8h chez lui), choisi par l'autre avant.
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  learner text not null references public.people(id),
  deliver_at timestamptz not null,
  proposals text[] not null,
  rerolled boolean not null default false,
  chosen text references public.words(id),
  chosen_by text,
  chosen_at timestamptz,
  delivered_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (learner, deliver_at)
);
create index if not exists rounds_learner_open on public.rounds (learner) where delivered_at is null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id text not null references public.people(id),
  auth_uid uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications_log (
  id bigserial primary key,
  person_id text,
  kind text,
  title text,
  body text,
  sent int,
  created_at timestamptz not null default now()
);

-- Helpers ------------------------------------------------------------------
create or replace function public.current_person_id() returns text
language sql stable security definer set search_path = public as $$
  select person_id from public.devices where auth_uid = auth.uid()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.devices where auth_uid = auth.uid())
$$;

create or replace function public.partner_of(p text) returns text
language sql immutable as $$ select case when p = 'matis' then 'stella' else 'matis' end $$;

-- Prochaine livraison pour un apprenant : prochain "deliver_hour" dans son fuseau, après "from_ts".
create or replace function public.next_delivery(p_learner text, from_ts timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  p public.people%rowtype;
  local_now timestamp;
  cand timestamp;
begin
  select * into p from public.people where id = p_learner;
  local_now := from_ts at time zone p.tz;
  cand := date_trunc('day', local_now) + make_interval(hours => p.deliver_hour);
  if cand <= local_now then cand := cand + interval '1 day'; end if;
  return cand at time zone p.tz;
end $$;

-- 3 mots au hasard jamais encore livrés/choisis pour cet apprenant (et hors "exclude").
create or replace function public.pick_words(p_learner text, p_exclude text[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(id), '{}') from (
    select w.id from public.words w
    where w.id <> all (coalesce(p_exclude, '{}'))
      and not exists (select 1 from public.rounds r where r.learner = p_learner and r.chosen = w.id)
    order by random() limit 3
  ) s
$$;

-- Garantit qu'il existe une manche ouverte (non livrée) pour l'apprenant.
create or replace function public.ensure_open_round(p_learner text) returns public.rounds
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  last_deliver timestamptz;
  d timestamptz;
begin
  select * into r from public.rounds where learner = p_learner and delivered_at is null
    order by deliver_at limit 1;
  if found then return r; end if;
  select max(deliver_at) into last_deliver from public.rounds where learner = p_learner;
  d := public.next_delivery(p_learner, greatest(now(), coalesce(last_deliver, now())));
  insert into public.rounds (learner, deliver_at, proposals)
    values (p_learner, d, public.pick_words(p_learner, '{}'))
  returning * into r;
  return r;
end $$;

-- RLS ------------------------------------------------------------------------
alter table public.people enable row level security;
alter table public.app_config enable row level security;
alter table public.devices enable row level security;
alter table public.words enable row level security;
alter table public.rounds enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications_log enable row level security;

create policy "people read members" on public.people for select to authenticated using (public.is_member());
create policy "words read members" on public.words for select to authenticated using (public.is_member());
-- On ne peut pas lire une manche non livrée dont on est l'apprenant (pas de triche sur le mot de demain).
create policy "rounds read members" on public.rounds for select to authenticated
  using (public.is_member() and (delivered_at is not null or learner <> public.current_person_id()));
create policy "devices read own" on public.devices for select to authenticated using (auth_uid = auth.uid());
create policy "subs read own" on public.push_subscriptions for select to authenticated using (auth_uid = auth.uid());
create policy "subs insert own" on public.push_subscriptions for insert to authenticated
  with check (auth_uid = auth.uid() and person_id = public.current_person_id());
create policy "subs delete own" on public.push_subscriptions for delete to authenticated using (auth_uid = auth.uid());

-- RPC -------------------------------------------------------------------------
create or replace function public.join_couple(p_code text, p_person text) returns public.people
language plpgsql security definer set search_path = public as $$
declare
  real_code text;
  p public.people%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select value into real_code from public.app_config where key = 'couple_code';
  if real_code is null or real_code <> p_code then
    perform pg_sleep(1);
    raise exception 'bad_code';
  end if;
  if p_person not in ('matis','stella') then raise exception 'bad_person'; end if;
  insert into public.devices (auth_uid, person_id) values (auth.uid(), p_person)
    on conflict (auth_uid) do update set person_id = excluded.person_id;
  select * into p from public.people where id = p_person;
  return p;
end $$;

create or replace function public.leave_couple() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where auth_uid = auth.uid();
  delete from public.devices where auth_uid = auth.uid();
end $$;

create or replace function public.set_lang(p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_lang not in ('fr','zh') then raise exception 'bad_lang'; end if;
  update public.people set lang = p_lang where id = public.current_person_id();
end $$;

create or replace function public.word_json(w public.words) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', w.id, 'fr', w.fr, 'zh', w.zh, 'pinyin', w.pinyin, 'en', w.en, 'kind', w.kind, 'theme', w.theme)
$$;

-- Etat complet pour l'appli : moi, mon mot du jour, la manche à choisir pour l'autre.
create or replace function public.get_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_person_id();
  other text;
  me_row public.people%rowtype;
  other_row public.people%rowtype;
  today_round public.rounds%rowtype;
  open_round public.rounds%rowtype;
  props jsonb;
  today_word jsonb;
begin
  if me is null then raise exception 'not_member'; end if;
  other := public.partner_of(me);
  select * into me_row from public.people where id = me;
  select * into other_row from public.people where id = other;

  -- Mon mot du jour = dernière manche livrée pour moi
  select * into today_round from public.rounds where learner = me and delivered_at is not null
    order by deliver_at desc limit 1;
  if found then
    select public.word_json(w) into today_word from public.words w where w.id = today_round.chosen;
  end if;

  -- La manche que je dois choisir pour l'autre
  open_round := public.ensure_open_round(other);
  select coalesce(jsonb_agg(public.word_json(w) order by array_position(open_round.proposals, w.id)), '[]')
    into props from public.words w where w.id = any (open_round.proposals);

  return jsonb_build_object(
    'me', jsonb_build_object('id', me_row.id, 'name', me_row.name, 'learns', me_row.learns, 'lang', me_row.lang, 'tz', me_row.tz,
                             'deliver_hour', me_row.deliver_hour, 'remind_hour', me_row.remind_hour),
    'partner', jsonb_build_object('id', other_row.id, 'name', other_row.name, 'learns', other_row.learns, 'tz', other_row.tz,
                                  'deliver_hour', other_row.deliver_hour),
    'today', case when today_word is null then null else jsonb_build_object(
        'round_id', today_round.id, 'word', today_word, 'deliver_at', today_round.deliver_at,
        'chosen_by', today_round.chosen_by, 'next_deliver_at', (select min(deliver_at) from public.rounds where learner = me and delivered_at is null)) end,
    'to_choose', jsonb_build_object('round_id', open_round.id, 'deliver_at', open_round.deliver_at, 'proposals', props,
                                    'rerolled', open_round.rerolled, 'chosen', open_round.chosen, 'chosen_by', open_round.chosen_by),
    'now', now()
  );
end $$;

create or replace function public.choose_word(p_round uuid, p_word text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_person_id();
  r public.rounds%rowtype;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into r from public.rounds where id = p_round for update;
  if not found or r.learner <> public.partner_of(me) then raise exception 'bad_round'; end if;
  if r.delivered_at is not null or now() >= r.deliver_at then raise exception 'too_late'; end if;
  if not (p_word = any (r.proposals)) then raise exception 'bad_word'; end if;
  update public.rounds set chosen = p_word, chosen_by = me, chosen_at = now() where id = p_round;
  return public.get_state();
end $$;

create or replace function public.reroll(p_round uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_person_id();
  r public.rounds%rowtype;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into r from public.rounds where id = p_round for update;
  if not found or r.learner <> public.partner_of(me) then raise exception 'bad_round'; end if;
  if r.delivered_at is not null or now() >= r.deliver_at then raise exception 'too_late'; end if;
  if r.rerolled then raise exception 'already_rerolled'; end if;
  if r.chosen is not null then raise exception 'already_chosen'; end if;
  update public.rounds set proposals = public.pick_words(r.learner, r.proposals), rerolled = true where id = p_round;
  return public.get_state();
end $$;

-- Historique : mots livrés (pour moi et pour l'autre), du plus récent au plus ancien.
create or replace function public.history() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'round_id', r.id, 'learner', r.learner, 'deliver_at', r.deliver_at, 'chosen_by', r.chosen_by, 'word', public.word_json(w))
      order by r.deliver_at desc), '[]')
  from public.rounds r join public.words w on w.id = r.chosen
  where r.delivered_at is not null and public.is_member()
$$;

grant execute on function public.join_couple(text, text) to authenticated;
grant execute on function public.leave_couple() to authenticated;
grant execute on function public.set_lang(text) to authenticated;
grant execute on function public.get_state() to authenticated;
grant execute on function public.choose_word(uuid, text) to authenticated;
grant execute on function public.reroll(uuid) to authenticated;
grant execute on function public.history() to authenticated;
revoke execute on function public.ensure_open_round(text) from public, anon, authenticated;
revoke execute on function public.pick_words(text, text[]) from public, anon, authenticated;

-- Fonction appelée par la fonction serveur (service_role) : livre les manches arrivées à échéance.
-- Retourne les manches livrées à l'instant (pour envoyer les notifications).
create or replace function public.deliver_due() returns setof public.rounds
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  pick text;
begin
  for r in select * from public.rounds where delivered_at is null and deliver_at <= now() for update loop
    if r.chosen is null then
      pick := r.proposals[1 + floor(random() * array_length(r.proposals, 1))::int];
      update public.rounds set chosen = pick, chosen_by = 'auto', chosen_at = now(), delivered_at = now()
        where id = r.id returning * into r;
    else
      update public.rounds set delivered_at = now() where id = r.id returning * into r;
    end if;
    return next r;
    perform public.ensure_open_round(r.learner);
  end loop;
  return;
end $$;
revoke execute on function public.deliver_due() from public, anon, authenticated;
