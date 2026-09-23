export type Reviewer = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
};

export type Sample = {
  id: number;
  row_index: string | null;
  patient_id: string | null;
  author: string | null;
  oph_record: string;
  gt: string;
  extra: Record<string, unknown>;
  oph_revised: string | null;
  oph_edited: boolean;
  gt_revised: string | null;
  gt_edited: boolean;
  reviewer_note: string | null;
  review_saved: boolean;
  review_excluded: boolean;
  review_saved_at: string | null;
  review_excluded_at: string | null;
  assigned_to: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type ReviewerProgress = {
  reviewer_id: string;
  email: string;
  display_name: string | null;
  total_assigned: number;
  done: number;
  valid: number;
  excluded: number;
  gt_edited_count: number;
  oph_edited_count: number;
  last_activity_at: string | null;
};

// samples 목록에서 리스트에 보여줄 최소 필드만 뽑은 타입
export type SampleListItem = Pick<
  Sample,
  | "id"
  | "row_index"
  | "patient_id"
  | "review_saved"
  | "review_excluded"
  | "gt_edited"
  | "oph_edited"
>;
