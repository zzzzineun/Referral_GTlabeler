-- =============================================================================
-- GT Review Labeler - Supabase Schema
-- =============================================================================
-- Supabase 프로젝트 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행하세요.
-- 이미 실행한 뒤에도 안전하게 재실행 가능 (idempotent).
-- =============================================================================


-- =============================================================================
-- 1) reviewers: 로그인 허용된 이메일 whitelist + admin 플래그
-- =============================================================================
-- 로그인 흐름: 유저가 이메일 입력 → 이 테이블에 있으면 매직링크 전송, 없으면 거부
-- admin=true 인 사람만 /admin 페이지 접근 가능
create table if not exists reviewers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table reviewers is 'Whitelist of allowed emails. Only these emails can log in.';


-- =============================================================================
-- 2) samples: 라벨링 대상 데이터. 기존 tkinter 버전의 CSV 컬럼을 그대로 반영.
-- =============================================================================
create table if not exists samples (
  id bigserial primary key,

  -- CSV 원본 컬럼 (변경 불가, 감사용)
  row_index text,
  patient_id text,                   -- CSV의 "연구별 환자 ID"
  author text,                       -- CSV의 "작성의"
  oph_record text not null,          -- 원본 OPH record (수정 안 됨)
  gt text not null,                  -- LLM이 만든 GT 초안 (수정 안 됨)

  -- 자유 형식 메타컬럼 (CSV에 있던 나머지 컬럼들을 이 JSONB에 통째로 저장)
  extra jsonb not null default '{}'::jsonb,

  -- 편집 결과
  oph_revised text,                  -- 편집한 OPH. null 이면 원본 그대로 사용
  oph_edited boolean not null default false,
  gt_revised text,                   -- 편집한 GT
  gt_edited boolean not null default false,

  -- 리뷰어별 메모 (샘플마다 별도)
  reviewer_note text,

  -- 진행 상태
  review_saved boolean not null default false,
  review_excluded boolean not null default false,
  review_saved_at timestamptz,
  review_excluded_at timestamptz,

  -- 담당 배정
  assigned_to uuid references reviewers(id) on delete set null,

  -- 낙관적 잠금 (동시 편집 감지용)
  updated_at timestamptz not null default now(),
  updated_by uuid references reviewers(id) on delete set null
);

create index if not exists samples_assigned_to_idx on samples(assigned_to);
create index if not exists samples_review_saved_idx on samples(review_saved);


-- =============================================================================
-- 3) edit_logs: audit trail - 편집 이력 (before/after 모두 보존)
-- =============================================================================
create table if not exists edit_logs (
  id bigserial primary key,
  sample_id bigint not null references samples(id) on delete cascade,
  reviewer_id uuid references reviewers(id) on delete set null,
  column_name text not null,       -- 'oph_record' | 'gt' | 'reviewer_note'
  before_text text,
  after_text text,
  edited_at timestamptz not null default now()
);

create index if not exists edit_logs_sample_id_idx on edit_logs(sample_id);


-- =============================================================================
-- 4) 자동 updated_at 갱신 트리거
-- =============================================================================
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists samples_touch_updated_at on samples;
create trigger samples_touch_updated_at
  before update on samples
  for each row execute function touch_updated_at();


-- =============================================================================
-- 5) Row Level Security (RLS)
-- =============================================================================
-- 원칙:
--   - 리뷰어는 본인에게 배정된 (assigned_to = 자기 자신) sample 만 볼 수 있음
--   - admin 은 전부 볼 수 있음
--   - reviewers 테이블은 admin 만 쓸 수 있음 (읽기는 로그인한 사람 모두)
--   - edit_logs 는 서버(service role) 만 씀; 리뷰어는 읽기 X (audit용)
-- =============================================================================

alter table reviewers enable row level security;
alter table samples enable row level security;
alter table edit_logs enable row level security;


-- 현재 auth 유저의 reviewer 레코드를 반환하는 헬퍼
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


-- reviewers 정책
drop policy if exists "reviewers read all" on reviewers;
create policy "reviewers read all"
  on reviewers for select
  to authenticated
  using (true);

drop policy if exists "reviewers write admin only" on reviewers;
create policy "reviewers write admin only"
  on reviewers for all
  to authenticated
  using (current_reviewer_is_admin())
  with check (current_reviewer_is_admin());


-- samples 정책
drop policy if exists "samples read own or admin" on samples;
create policy "samples read own or admin"
  on samples for select
  to authenticated
  using (
    current_reviewer_is_admin()
    or assigned_to = current_reviewer_id()
  );

drop policy if exists "samples update own or admin" on samples;
create policy "samples update own or admin"
  on samples for update
  to authenticated
  using (
    current_reviewer_is_admin()
    or assigned_to = current_reviewer_id()
  )
  with check (
    current_reviewer_is_admin()
    or assigned_to = current_reviewer_id()
  );

drop policy if exists "samples insert admin only" on samples;
create policy "samples insert admin only"
  on samples for insert
  to authenticated
  with check (current_reviewer_is_admin());

drop policy if exists "samples delete admin only" on samples;
create policy "samples delete admin only"
  on samples for delete
  to authenticated
  using (current_reviewer_is_admin());


-- edit_logs 정책: 리뷰어는 자기 로그만 볼 수 있음; 삽입은 서비스 롤 또는 자기 자신만
drop policy if exists "edit_logs read own or admin" on edit_logs;
create policy "edit_logs read own or admin"
  on edit_logs for select
  to authenticated
  using (
    current_reviewer_is_admin()
    or reviewer_id = current_reviewer_id()
  );

drop policy if exists "edit_logs insert own" on edit_logs;
create policy "edit_logs insert own"
  on edit_logs for insert
  to authenticated
  with check (reviewer_id = current_reviewer_id());


-- =============================================================================
-- 6) 진행 통계 뷰 (admin 페이지에서 사용)
-- =============================================================================
create or replace view reviewer_progress as
select
  r.id as reviewer_id,
  r.email,
  r.display_name,
  count(s.id) as total_assigned,
  count(s.id) filter (where s.review_saved) as done,
  count(s.id) filter (where s.review_saved and not s.review_excluded) as valid,
  count(s.id) filter (where s.review_excluded) as excluded,
  count(s.id) filter (where s.gt_edited) as gt_edited_count,
  count(s.id) filter (where s.oph_edited) as oph_edited_count,
  max(s.updated_at) as last_activity_at
from reviewers r
left join samples s on s.assigned_to = r.id
group by r.id, r.email, r.display_name
order by r.email;


-- =============================================================================
-- 7) 초기 admin 계정 등록
-- =============================================================================
-- 아래 이메일을 본인 이메일로 바꾸고 실행하세요. 이 계정으로 로그인해서
-- /admin 페이지에서 다른 리뷰어를 등록하거나 CSV를 임포트할 수 있습니다.
--
-- insert into reviewers (email, display_name, is_admin) values
--   ('YOUR_EMAIL@example.com', 'Admin', true)
-- on conflict (email) do update set is_admin = true;
