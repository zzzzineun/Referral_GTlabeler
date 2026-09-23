export type Reviewer = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
};

// samples 테이블 (원본, immutable)
export type Sample = {
  id: number;
  row_index: string | null;
  patient_id: string | null;
  author: string | null;
  oph_record: string;
  gt: string;
  extra: Record<string, unknown>;
  created_at: string;
};

// assignments 테이블 (per-reviewer 라벨링 상태)
export type Assignment = {
  id: number;
  sample_id: number;
  reviewer_id: string;
  oph_revised: string | null;
  oph_edited: boolean;
  gt_revised: string | null;
  gt_edited: boolean;
  reviewer_note: string | null;
  review_saved: boolean;
  review_excluded: boolean;
  review_saved_at: string | null;
  review_excluded_at: string | null;
  updated_at: string;
};

// UI에서 편집 화면에 로드될 때 쓰이는 flat 타입
// (assignment 필드 + sample 원본 필드를 한 객체로)
export type LoadedItem = Assignment & {
  oph_record: string;
  gt: string;
  patient_id: string | null;
  author: string | null;
  row_index: string | null;
};

// 사이드바 리스트에 표시할 최소 정보
export type AssignmentListItem = {
  id: number;
  sample_id: number;
  row_index: string | null;
  patient_id: string | null;
  review_saved: boolean;
  review_excluded: boolean;
  gt_edited: boolean;
  oph_edited: boolean;
};

export type ReviewerProgress = {
  reviewer_id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  total_assigned: number;
  done: number;
  valid: number;
  excluded: number;
  gt_edited_count: number;
  oph_edited_count: number;
  last_activity_at: string | null;
};
