# GT Review Labeler (Web)

Next.js + Supabase 기반의 웹 라벨링 도구.
`oph_record` 를 참고하며 LLM이 생성한 `gt` 초안을 사람이 검수·수정하는 워크플로우.

이전 tkinter 버전의 기능을 웹으로 옮긴 것으로, 여러 명이 URL 하나로 접속해서
각자 배정된 샘플을 이어서 라벨링할 수 있습니다.

---

## 주요 기능

- **이메일 매직링크 로그인** (whitelist 방식 — 등록된 이메일만 로그인 가능)
- **리뷰어별 담당 배정** — 본인에게 배정된 샘플만 리스트에 표시
- **좌우 분할 편집** — OPH Record / GT 둘 다 편집 가능 (원본은 `_revised` 컬럼에 별도 저장)
- **참고 박스** — 상단 접었다 펼 수 있는 포맷/예시 가이드
- **메모장** — 우측 접었다 펼 수 있는 샘플별 메모 (`reviewer_note` 컬럼)
- **이전/저장/다음** — 이전·다음 이동 시 자동 저장, 저장 버튼은 명시적 완료 표시
- **제외 처리** — 부적합한 샘플 제외
- **감사 로그** — 모든 편집이 `edit_logs` 테이블에 before/after 기록
- **Admin 대시보드** — 리뷰어별 진행 통계, CSV 임포트, 리뷰어 관리

---

## 설정 순서

### 1. Supabase 프로젝트 생성

1. https://supabase.com 회원가입 후 새 프로젝트 생성 (무료 티어)
2. 대시보드 → **SQL Editor** → New query → `supabase/schema.sql` 전체 붙여넣고 실행
3. 대시보드 → **Authentication → Providers → Email** 에서:
   - "Enable Email provider" 체크
   - "Confirm email" 체크 (매직링크만 쓸 거면 없어도 되지만 켜두는 게 안전)
4. **Authentication → URL Configuration** 에서:
   - Site URL: 배포된 도메인 (개발 중이면 `http://localhost:3000`)
   - Redirect URLs: `http://localhost:3000/**` 와 배포 도메인의 `/**` 추가
5. 대시보드 → **Project Settings → API** 에서 다음 값 복사:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (secret) → `SUPABASE_SERVICE_ROLE_KEY` (배포 환경변수에만)

### 2. 초기 admin 계정 등록

SQL Editor에서 (본인 이메일로):

```sql
insert into reviewers (email, display_name, is_admin) values
  ('your_email@example.com', 'Admin', true)
on conflict (email) do update set is_admin = true;
```

이 계정으로 로그인 후, `/admin` 페이지에서 나머지 리뷰어를 등록하고 CSV를 임포트합니다.

### 3. 로컬 개발

```bash
npm install
cp .env.example .env.local
# .env.local 에 Supabase 값 채워넣기
npm run dev
```

브라우저: http://localhost:3000

### 4. Vercel 배포

1. GitHub에 이 프로젝트 push
2. https://vercel.com → Import Project → GitHub repo 선택
3. **Environment Variables** 에 다음 등록:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` — 배포 도메인 (예: `https://gt-labeler.vercel.app`)
4. Deploy
5. 배포 완료 후, Supabase 대시보드의 **Authentication → URL Configuration** 에도
   실제 배포 도메인을 등록 (안 하면 매직링크가 localhost로 리다이렉트됨)

---

## 사용 흐름

### Admin (관리자)

1. `/admin` → **리뷰어 관리** 탭 → 라벨링에 참여할 이메일 등록
2. `/admin` → **CSV 임포트** 탭 → 원본 CSV 업로드:
   - 필수 컬럼: `oph_record`, `gt`
   - 자동 인식: `row_index`, `연구별 환자 ID`, `작성의`
   - 그 외 컬럼: `extra` JSONB에 저장 (나중에 export 시 복원 가능)
3. 배정 방식 선택:
   - **배정하지 않음**: 나중에 SQL로 직접 배정
   - **순환 배정**: 선택한 리뷰어들에게 라운드로빈 (예: 500개 → 5명 → 각 100개)
4. `/admin` → **진행 통계** 탭에서 실시간 진행률 확인

### 리뷰어

1. 로그인 페이지에서 이메일 입력 → 이메일 확인 → 링크 클릭
2. 자동으로 `/label` 로 이동, 배정된 첫 미저장 샘플이 뜸
3. 왼쪽 사이드바에서 다른 샘플로 이동 가능 (색상: 흰색=미작업, 회색=완료, 노랑=수정됨, 빨강=제외, 파랑=현재)
4. OPH/GT 편집 → **이전 / 저장 / 다음** 중 선택
   - 이전/다음: 자동 저장 후 이동 (완료 표시 없음)
   - 저장: 완료 표시 + 다음 샘플로 이동
   - 제외: 부적합 표시 후 다음으로

### CSV 다시 내보내기

Supabase 대시보드 → **Table Editor → samples → Export CSV** 로 언제든 전체 DB export 가능.

또는 SQL Editor에서:
```sql
select * from samples order by id;
```
결과를 CSV로 다운로드.

---

## 데이터 스키마 요약

- **reviewers**: 로그인 whitelist (`email`, `is_admin`, `display_name`)
- **samples**: 라벨링 대상. 원본 `oph_record`/`gt` + 편집본 `oph_revised`/`gt_revised`
  + 상태 플래그 + 담당자 배정 + `reviewer_note`
- **edit_logs**: 모든 편집의 before/after audit trail
- **reviewer_progress** (view): admin 대시보드용 실시간 집계

Row Level Security (RLS) 로 리뷰어는 본인 배정 샘플만 조회/수정 가능,
admin은 전부 접근 가능.

---

## 폴더 구조

```
gt-labeler-web/
├── package.json, tsconfig.json, next.config.js, tailwind.config.js
├── .env.example                        # 환경변수 템플릿
├── middleware.ts                       # 세션 갱신 + 인증 가드
├── app/
│   ├── layout.tsx, page.tsx, globals.css
│   ├── login/page.tsx                  # 매직링크 로그인
│   ├── auth/callback/route.ts          # 링크 클릭 처리
│   ├── label/
│   │   ├── page.tsx                    # 서버 컴포넌트 (초기 데이터 로드)
│   │   └── labeling-client.tsx         # 메인 라벨링 UI
│   └── admin/
│       ├── page.tsx                    # 서버 컴포넌트 (권한 체크)
│       └── admin-client.tsx            # CSV 임포트 + 리뷰어 관리 + 통계
├── lib/
│   ├── constants.ts                    # FORMAT_TEMPLATE, EXAMPLE_TEXT 등
│   ├── types.ts                        # TypeScript 타입
│   └── supabase/{client,server,middleware}.ts
├── supabase/schema.sql                 # DB 스키마 (한 번 실행)
└── README.md
```

---

## 문제 해결

**매직링크 이메일이 안 옴** → Supabase 대시보드 → Authentication → Email Templates
확인. 무료 티어는 하루 발송 한도가 있음 (SMTP 커스텀 설정으로 회피 가능).

**로그인은 되는데 "not_registered" 오류** → `reviewers` 테이블에 그 이메일이 없음.
Admin으로 로그인해서 등록하거나 SQL로 insert.

**샘플이 안 보임** → 본인에게 배정된 게 없음. Admin이 배정하거나 SQL:
```sql
update samples set assigned_to = (select id from reviewers where email = 'x@x.com') where id in (...);
```

**동시 편집이 걱정됨** → 담당 배정 방식이므로 원칙적으로 다른 리뷰어가 같은 샘플에
동시 접근할 일이 없음. Admin은 모든 샘플에 접근 가능하지만 revised 컬럼 덮어쓰기
전에 리뷰어 것과 충돌 안 하도록 주의 필요.

**CSV 다시 임포트하고 싶음** → 기존 samples 를 모두 지우려면 SQL Editor에서:
```sql
truncate samples, edit_logs restart identity cascade;
```
