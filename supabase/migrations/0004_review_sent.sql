-- Révisions : on peut aussi ajouter à ses propres cartes les mots envoyés à l'autre (depuis l'historique).
-- Une même manche peut donc donner une carte à chacun : la clé devient (round_id, learner).
alter table mdj.cards drop constraint if exists cards_pkey;
alter table mdj.cards add primary key (round_id, learner);

create or replace function mdj.sync_cards(p text) returns void
language sql security definer set search_path = mdj, public as $$
  insert into mdj.cards (round_id, learner, word_id, due)
  select r.id, r.learner, r.chosen, (r.deliver_at at time zone pe.tz)::date + 1
  from mdj.rounds r join mdj.people pe on pe.id = r.learner
  where r.learner = p and r.delivered_at is not null and r.chosen is not null
  on conflict (round_id, learner) do nothing
$$;

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
    where round_id = p_round and learner = me;
  else
    ns := least(c.step + case when p_grade = 'easy' then 2 else 1 end, array_length(steps, 1) - 1);
    update mdj.cards set step = ns, reps = reps + 1, last_reviewed = today, due = today + steps[ns + 1]
    where round_id = p_round and learner = me;
  end if;
  return mdj.review_queue();
end $$;

-- Ajoute / retire de mes révisions un mot que j'ai envoyé à l'autre. Retourne true si la carte existe après l'appel.
create or replace function mdj.toggle_sent_card(p_round uuid) returns boolean
language plpgsql security definer set search_path = mdj, public as $$
declare
  me text := mdj.current_person_id();
  r mdj.rounds%rowtype;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into r from mdj.rounds where id = p_round and delivered_at is not null and chosen is not null;
  if not found or r.learner = me then raise exception 'not_found'; end if;
  delete from mdj.cards where round_id = p_round and learner = me;
  if found then return false; end if;
  insert into mdj.cards (round_id, learner, word_id, due) values (p_round, me, r.chosen, mdj.local_today(me));
  return true;
end $$;

create or replace function mdj.history() returns jsonb
language sql security definer set search_path = mdj, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'round_id', r.id, 'learner', r.learner, 'deliver_at', r.deliver_at, 'chosen_by', r.chosen_by, 'word', mdj.word_json(w),
      'in_review', exists (select 1 from mdj.cards c where c.round_id = r.id and c.learner = mdj.current_person_id()))
      order by r.deliver_at desc), '[]')
  from mdj.rounds r join mdj.words w on w.id = r.chosen
  where r.delivered_at is not null and mdj.is_member()
$$;

revoke execute on function mdj.sync_cards(text) from public, anon, authenticated;
grant execute on function mdj.review_answer(uuid, text) to authenticated;
grant execute on function mdj.toggle_sent_card(uuid) to authenticated;
grant execute on function mdj.history() to authenticated;
