import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AssignmentListItem, Reviewer } from "@/lib/types";
import LabelingClient from "./labeling-client";

export const dynamic = "force-dynamic";

export default async function LabelPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: reviewer } = await supabase
    .from("reviewers")
    .select("*")
    .eq("email", user.email!)
    .maybeSingle<Reviewer>();

  if (!reviewer) {
    // 트리거로 auto-register 됐어야 하는데 안 됐다면 이례적인 상황.
    redirect("/login?error=not_registered");
  }

  // 본인에게 배정된 assignments + 원본 sample 메타 (사이드바에 표시할 용도)
  const { data: rows, error } = await supabase
    .from("assignments")
    .select(
      `
      id,
      sample_id,
      review_saved,
      review_excluded,
      gt_edited,
      oph_edited,
      samples!inner ( row_index, patient_id )
      `,
    )
    .eq("reviewer_id", reviewer.id)
    .order("sample_id", { ascending: true });

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold text-red-600 mb-2">
          Assignment 목록 로드 실패
        </h1>
        <pre className="bg-red-50 p-4 rounded text-sm">{error.message}</pre>
      </div>
    );
  }

  const items: AssignmentListItem[] = ((rows ?? []) as unknown as Array<{
    id: number;
    sample_id: number;
    review_saved: boolean;
    review_excluded: boolean;
    gt_edited: boolean;
    oph_edited: boolean;
    samples: { row_index: string | null; patient_id: string | null } | null;
  }>).map((a) => ({
    id: a.id,
    sample_id: a.sample_id,
    row_index: a.samples?.row_index ?? null,
    patient_id: a.samples?.patient_id ?? null,
    review_saved: a.review_saved,
    review_excluded: a.review_excluded,
    gt_edited: a.gt_edited,
    oph_edited: a.oph_edited,
  }));

  return <LabelingClient reviewer={reviewer} initialItems={items} />;
}
