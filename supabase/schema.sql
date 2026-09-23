-- =============================================================================
-- GT Review Labeler v2 - Multi-reviewer Schema
-- =============================================================================
-- 시나리오 A: 각 리뷰어가 모든 샘플을 독립적으로 (blind) 라벨링.
-- 새 리뷰어 자동 가입 + 새 리뷰어 등장 시 모든 샘플 자동 배정.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run.
--
-- ⚠ 주의: 기존 labeling 데이터는 모두 삭제됩니다.
--   (reviewers 테이블은 유지되어 로그인 정보는 남습니다)
--   라벨링을 아직 시작하지 않았다면 안전합니다.
--   라벨링을 이미 시작했다면 실행 전 백업하세요.
-- =============================================================================


-- =============================================================================
-- 0) 정리 (idempotent — 여러 번 실행해도 안전)
-- =============================================================================
drop view if exists reviewer_progress cascade;
drop trigger if exists on_sample_created on samples cascade;
drop trigger if exists on_reviewer_created on reviewers cascade;
drop trigger if exists on_auth_user_created on auth.users cascade;
drop trigger if exists samples_touch_updated_at on samples cascade;
drop trigger if exists assignments_touch_updated_at on assignments cascade;
drop function if exists assign_all_samples_to_new_reviewer() cascade;
drop function if exists assign_new_sample_to_all_reviewers() cascade;
drop function if exists handle_new_auth_user() cascade;
drop function if exists current_reviewer_id() cascade;
drop function if exists current_reviewer_is_admin() cascade;
drop function if exists touch_updated_at() cascade;

drop table if exists edit_logs cascade;
drop table if exists assignments cascade;
drop table if exists samples cascade;
-- reviewers 는 남겨둠 (기존 admin 계정 보존)


-- =============================================================================
-- 1) reviewers (기존과 동일 — 이미 있으면 skip)
-- =============================================================================
create table if not exists reviewers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);


-- =============================================================================
-- 2) samples (원본 데이터, immutable)
-- =============================================================================
create table samples (
  id bigserial primary key,
  row_index text,
  patient_id text,
  author text,
  oph_record text not null,
  gt text not null,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


-- =============================================================================
-- 3) assignments (per-reviewer 라벨링 데이터)
-- =============================================================================
-- 각 (sample, reviewer) 쌍마다 하나의 행. N명 × 100 sample = N × 100 assignments.
create table assignments (
  id bigserial primary key,
  sample_id bigint not null references samples(id) on delete cascade,
  reviewer_id uuid not null references reviewers(id) on delete cascade,

  oph_revised text,
  oph_edited boolean not null default false,
  gt_revised text,
  gt_edited boolean not null default false,
  reviewer_note text,

  review_saved boolean not null default false,
  review_saved_at timestamptz,
  review_excluded boolean not null default false,
  review_excluded_at timestamptz,

  updated_at timestamptz not null default now(),

  unique (sample_id, reviewer_id)
);

create index assignments_reviewer_id_idx on assignments(reviewer_id);
create index assignments_sample_id_idx on assignments(sample_id);


-- =============================================================================
-- 4) edit_logs (assignment 단위로 audit)
-- =============================================================================
create table edit_logs (
  id bigserial primary key,
  assignment_id bigint not null references assignments(id) on delete cascade,
  reviewer_id uuid not null references reviewers(id) on delete cascade,
  column_name text not null,
  before_text text,
  after_text text,
  edited_at timestamptz not null default now()
);

create index edit_logs_assignment_id_idx on edit_logs(assignment_id);
create index edit_logs_reviewer_id_idx on edit_logs(reviewer_id);


-- =============================================================================
-- 5) touch_updated_at trigger
-- =============================================================================
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assignments_touch_updated_at
  before update on assignments
  for each row execute function touch_updated_at();


-- =============================================================================
-- 6) Auto-registration: 첫 로그인 시 reviewers에 자동 등록
-- =============================================================================
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.reviewers (email, is_admin)
  values (new.email, false)
  on conflict (email) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();


-- =============================================================================
-- 7) Auto-assign: 새 리뷰어 → 기존 모든 샘플 assignment 생성
-- =============================================================================
create or replace function assign_all_samples_to_new_reviewer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.assignments (sample_id, reviewer_id)
  select s.id, new.id from public.samples s
  on conflict (sample_id, reviewer_id) do nothing;
  return new;
end;
$$;

create trigger on_reviewer_created
  after insert on reviewers
  for each row execute function assign_all_samples_to_new_reviewer();


-- =============================================================================
-- 8) Auto-assign: 새 sample → 기존 모든 리뷰어 assignment 생성
-- =============================================================================
create or replace function assign_new_sample_to_all_reviewers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.assignments (sample_id, reviewer_id)
  select new.id, r.id from public.reviewers r
  on conflict (sample_id, reviewer_id) do nothing;
  return new;
end;
$$;

create trigger on_sample_created
  after insert on samples
  for each row execute function assign_new_sample_to_all_reviewers();


-- =============================================================================
-- 9) RLS
-- =============================================================================
alter table reviewers enable row level security;
alter table samples enable row level security;
alter table assignments enable row level security;
alter table edit_logs enable row level security;

create or replace function current_reviewer_id()
returns uuid language sql stable as $$
  select id from reviewers where email = (auth.jwt() ->> 'email')
$$;

create or replace function current_reviewer_is_admin()
returns boolean language sql stable as $$
  select coalesce(
    (select is_admin from reviewers where email = (auth.jwt() ->> 'email')),
    false
  )
$$;

-- reviewers
create policy "reviewers read all"
  on reviewers for select to authenticated using (true);
create policy "reviewers write admin only"
  on reviewers for all to authenticated
  using (current_reviewer_is_admin())
  with check (current_reviewer_is_admin());

-- samples (원본 데이터라 blind 무관; 모두 조회 가능. 쓰기는 admin만)
create policy "samples read all"
  on samples for select to authenticated using (true);
create policy "samples insert admin only"
  on samples for insert to authenticated with check (current_reviewer_is_admin());
create policy "samples delete admin only"
  on samples for delete to authenticated using (current_reviewer_is_admin());

-- assignments (본인 것만; admin은 통계용 all read)
create policy "assignments read own or admin"
  on assignments for select to authenticated
  using (reviewer_id = current_reviewer_id() or current_reviewer_is_admin());
create policy "assignments update own"
  on assignments for update to authenticated
  using (reviewer_id = current_reviewer_id())
  with check (reviewer_id = current_reviewer_id());

-- edit_logs
create policy "edit_logs read own or admin"
  on edit_logs for select to authenticated
  using (reviewer_id = current_reviewer_id() or current_reviewer_is_admin());
create policy "edit_logs insert own"
  on edit_logs for insert to authenticated
  with check (reviewer_id = current_reviewer_id());


-- =============================================================================
-- 10) 통계 뷰
-- =============================================================================
create or replace view reviewer_progress as
select
  r.id as reviewer_id,
  r.email,
  r.display_name,
  r.is_admin,
  count(a.id) as total_assigned,
  count(a.id) filter (where a.review_saved) as done,
  count(a.id) filter (where a.review_saved and not a.review_excluded) as valid,
  count(a.id) filter (where a.review_excluded) as excluded,
  count(a.id) filter (where a.gt_edited) as gt_edited_count,
  count(a.id) filter (where a.oph_edited) as oph_edited_count,
  max(a.updated_at) as last_activity_at
from reviewers r
left join assignments a on a.reviewer_id = r.id
group by r.id, r.email, r.display_name, r.is_admin
order by r.email;
