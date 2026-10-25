-- Révisions espacées (flashcards) : une carte par mot reçu, paliers 1/3/7/14/30/60/120/180 jours.
create table if not exists mdj.cards (
  round_id uuid primary key references mdj.rounds(id) on delete cascade,
  learner text not null references mdj.people(id),
  word_id text not null references mdj.words(id),
  step int not null default 0,
  due date not null,
  reps int not null default 0,
  lapses int not null default 0,
  last_reviewed date,
  created_at timestamptz not null default now()
);
create index if not exists cards_learner_due on mdj.cards (learner, due);
alter table mdj.cards enable row level security;
drop policy if exists "cards read own" on mdj.cards;
create policy "cards read own" on mdj.cards for select to authenticated using (learner = mdj.current_person_id());
grant select on mdj.cards to authenticated;
grant all on mdj.cards to service_role;

create or replace function mdj.local_today(p text) returns date
language sql stable security definer set search_path = mdj, public as $$
  select (now() at time zone (select tz from mdj.people where id = p))::date
$$;

-- Crée les cartes manquantes pour les mots déjà livrés (première révision le lendemain de la livraison).
create or replace function mdj.sync_cards(p text) returns void
language sql security definer set search_path = mdj, public as $$
  insert into mdj.cards (round_id, learner, word_id, due)
  select r.id, r.learner, r.chosen, (r.deliver_at at time zone pe.tz)::date + 1
  from mdj.rounds r join mdj.people pe on pe.id = r.learner
  where r.learner = p and r.delivered_at is not null and r.chosen is not null
  on conflict (round_id) do nothing
$$;

create or replace function mdj.review_due_count() returns int
language plpgsql security definer set search_path = mdj, public as $$
declare me text := mdj.current_person_id(); today date; done int; due_n int;
begin
  if me is null then return 0; end if;
  perform mdj.sync_cards(me);
  today := mdj.local_today(me);
  select count(*) into done from mdj.cards where learner = me and last_reviewed = today and due > today;
  select count(*) into due_n from mdj.cards where learner = me and due <= today;
  return least(due_n, greatest(15 - done, 0));
end $$;

-- File du jour : les cartes dues (max 15 nouvelles par jour ; celles ratées aujourd'hui reviennent sans limite).
create or replace function mdj.review_queue() returns jsonb
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  today date; done int; lim int := 15; due_total int; queue jsonb;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  perform mdj.sync_cards(me);
  today := mdj.local_today(me);
  select count(*) into done from mdj.cards where learner = me and last_reviewed = today;
  select count(*) into due_total from mdj.cards where learner = me and due <= today;
  with fresh as (
    select c.* from mdj.cards c
    where c.learner = me and c.due <= today and (c.last_reviewed is null or c.last_reviewed < today)
    order by c.due, random() limit greatest(lim - done, 0)
  ), again as (
    select c.* from mdj.cards c where c.learner = me and c.due <= today and c.last_reviewed = today
  ), q as (select *, false as is_again from fresh union all select *, true from again)
  select coalesce(jsonb_agg(jsonb_build_object(
      'round_id', q.round_id, 'step', q.step, 'reps', q.reps, 'again', q.is_again, 'word', mdj.word_json(w))
      order by q.is_again, q.due), '[]')
  into queue from q join mdj.words w on w.id = q.word_id;
  return jsonb_build_object('cards', queue, 'done_today', done, 'due_total', due_total, 'limit', lim,
    'total', (select count(*) from mdj.cards where learner = me),
    'learned', (select count(*) from mdj.cards where learner = me and step >= 7));
end $$;

create or replace function mdj.review_answer(p_round uuid, p_grade text) returns jsonb
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  today date; c mdj.cards%rowtype;
  steps int[] := array[1, 3, 7, 14, 30, 60, 120, 180];
  ns int;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_grade not in ('again', 'good', 'easy') then raise exception 'bad_grade'; end if;
  today := mdj.local_today(me);
  select * into c from mdj.cards where round_id = p_round and learner = me for update;
  if not found then raise exception 'not_found'; end if;
  if p_grade = 'again' then
    update mdj.cards set step = 0, lapses = lapses + 1, reps = reps + 1, last_reviewed = today, due = today
    where round_id = p_round;
  else
    ns := least(c.step + case when p_grade = 'easy' then 2 else 1 end, array_length(steps, 1) - 1);
    update mdj.cards set step = ns, reps = reps + 1, last_reviewed = today, due = today + steps[ns + 1]
    where round_id = p_round;
  end if;
  return mdj.review_queue();
end $$;

revoke execute on function mdj.sync_cards(text) from public, anon, authenticated;
revoke execute on function mdj.local_today(text) from public, anon, authenticated;
grant execute on function mdj.review_due_count() to authenticated;
grant execute on function mdj.review_queue() to authenticated;
grant execute on function mdj.review_answer(uuid, text) to authenticated;
