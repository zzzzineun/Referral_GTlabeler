"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  EXAMPLE_TEXT,
  FORMAT_TEMPLATE,
  parseMarkdownBold,
} from "@/lib/constants";
import type {
  Assignment,
  AssignmentListItem,
  LoadedItem,
  Reviewer,
} from "@/lib/types";

type Props = {
  reviewer: Reviewer;
  initialItems: AssignmentListItem[];
};

type DraftState = {
  oph: string;
  gt: string;
  note: string;
};

export default function LabelingClient({ reviewer, initialItems }: Props) {
  const supabase = createClient();
  const router = useRouter();

  const [items, setItems] = useState<AssignmentListItem[]>(initialItems);
  const [currentIdx, setCurrentIdx] = useState<number>(() =>
    findFirstUnsavedIdx(initialItems),
  );
  const [currentItem, setCurrentItem] = useState<LoadedItem | null>(null);
  const [draft, setDraft] = useState<DraftState>({ oph: "", gt: "", note: "" });
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [noteOpen, setNoteOpen] = useState(true);

  const currentAssignmentIdRef = useRef<number | null>(null);
  const draftRef = useRef<DraftState>(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // ---------- 로드 ----------
  const loadItem = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= items.length) return;
      const targetId = items[idx].id;
      setLoading(true);
      setSaveStatus("idle");
      setSaveError(null);

      // assignment + 원본 sample 을 한번에 fetch
      const { data, error } = await supabase
        .from("assignments")
        .select(
          `
          *,
          samples!inner ( row_index, patient_id, author, oph_record, gt )
          `,
        )
        .eq("id", targetId)
        .maybeSingle();

      setLoading(false);

      if (error || !data) {
        setSaveStatus("error");
        setSaveError(error?.message ?? "Assignment 를 찾을 수 없습니다");
        return;
      }

      const row = data as unknown as Assignment & {
        samples: {
          row_index: string | null;
          patient_id: string | null;
          author: string | null;
          oph_record: string;
          gt: string;
        };
      };

      const loaded: LoadedItem = {
        id: row.id,
        sample_id: row.sample_id,
        reviewer_id: row.reviewer_id,
        oph_revised: row.oph_revised,
        oph_edited: row.oph_edited,
        gt_revised: row.gt_revised,
        gt_edited: row.gt_edited,
        reviewer_note: row.reviewer_note,
        review_saved: row.review_saved,
        review_excluded: row.review_excluded,
        review_saved_at: row.review_saved_at,
        review_excluded_at: row.review_excluded_at,
        updated_at: row.updated_at,
        oph_record: row.samples.oph_record,
        gt: row.samples.gt,
        patient_id: row.samples.patient_id,
        author: row.samples.author,
        row_index: row.samples.row_index,
      };

      setCurrentItem(loaded);
      currentAssignmentIdRef.current = loaded.id;
      setDraft({
        oph: loaded.oph_revised ?? loaded.oph_record,
        gt: loaded.gt_revised ?? loaded.gt,
        note: loaded.reviewer_note ?? "",
      });
      setCurrentIdx(idx);
    },
    [items, supabase],
  );

  useEffect(() => {
    if (items.length > 0) {
      loadItem(currentIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 저장 ----------
  const persist = useCallback(
    async (opts: {
      markSaved?: boolean;
      markExcluded?: boolean;
    }): Promise<{ ok: boolean; message?: string }> => {
      const item = currentItem;
      const assignmentId = currentAssignmentIdRef.current;
      if (!item || assignmentId == null)
        return { ok: false, message: "no item" };

      const d = draftRef.current;
      const now = new Date().toISOString();

      const ophChanged = d.oph !== (item.oph_revised ?? item.oph_record);
      const gtChanged = d.gt !== (item.gt_revised ?? item.gt);
      const noteChanged = d.note !== (item.reviewer_note ?? "");

      const patch: Partial<Assignment> = {};

      if (ophChanged) {
        patch.oph_revised = d.oph;
        patch.oph_edited = d.oph !== item.oph_record;
      }
      if (gtChanged) {
        patch.gt_revised = d.gt;
        patch.gt_edited = d.gt !== item.gt;
      }
      if (noteChanged) {
        patch.reviewer_note = d.note;
      }
      if (opts.markSaved) {
        patch.review_saved = true;
        patch.review_saved_at = now;
      }
      if (opts.markExcluded) {
        patch.review_excluded = true;
        patch.review_excluded_at = now;
        patch.review_saved = true;
        patch.review_saved_at = now;
      }

      const nothingToDo =
        !ophChanged &&
        !gtChanged &&
        !noteChanged &&
        !opts.markSaved &&
        !opts.markExcluded;
      if (nothingToDo) return { ok: true };

      setSaveStatus("saving");

      const { error: updateError } = await supabase
        .from("assignments")
        .update(patch)
        .eq("id", assignmentId);

      if (updateError) {
        setSaveStatus("error");
        setSaveError(updateError.message);
        return { ok: false, message: updateError.message };
      }

      // audit log
      const logEntries: Array<{
        assignment_id: number;
        reviewer_id: string;
        column_name: string;
        before_text: string | null;
        after_text: string;
      }> = [];
      if (ophChanged) {
        logEntries.push({
          assignment_id: assignmentId,
          reviewer_id: reviewer.id,
          column_name: "oph_record",
          before_text: item.oph_revised ?? item.oph_record,
          after_text: d.oph,
        });
      }
      if (gtChanged) {
        logEntries.push({
          assignment_id: assignmentId,
          reviewer_id: reviewer.id,
          column_name: "gt",
          before_text: item.gt_revised ?? item.gt,
          after_text: d.gt,
        });
      }
      if (noteChanged) {
        logEntries.push({
          assignment_id: assignmentId,
          reviewer_id: reviewer.id,
          column_name: "reviewer_note",
          before_text: item.reviewer_note ?? "",
          after_text: d.note,
        });
      }
      if (logEntries.length > 0) {
        await supabase.from("edit_logs").insert(logEntries);
      }

      // 사이드바 갱신
      setItems((prev) =>
        prev.map((s) =>
          s.id === assignmentId
            ? {
                ...s,
                review_saved: patch.review_saved ?? s.review_saved,
                review_excluded: patch.review_excluded ?? s.review_excluded,
                gt_edited: patch.gt_edited ?? s.gt_edited,
                oph_edited: patch.oph_edited ?? s.oph_edited,
              }
            : s,
        ),
      );

      setCurrentItem((prev) =>
        prev ? ({ ...prev, ...patch } as LoadedItem) : prev,
      );

      setSaveStatus("saved");
      return { ok: true };
    },
    [currentItem, reviewer.id, supabase],
  );

  // ---------- 액션 ----------
  const handlePrev = useCallback(async () => {
    if (currentIdx <= 0) return;
    await persist({});
    await loadItem(currentIdx - 1);
  }, [currentIdx, persist, loadItem]);

  const handleNext = useCallback(async () => {
    if (currentIdx >= items.length - 1) return;
    await persist({});
    await loadItem(currentIdx + 1);
  }, [currentIdx, items.length, persist, loadItem]);

  const handleSave = useCallback(async () => {
    const res = await persist({ markSaved: true });
    if (res.ok) {
      setTimeout(() => {
        if (currentIdx < items.length - 1) {
          loadItem(currentIdx + 1);
        }
      }, 200);
    }
  }, [persist, currentIdx, items.length, loadItem]);

  const handleExclude = useCallback(async () => {
    if (!confirm("이 샘플을 제외로 표시할까요?")) return;
    const res = await persist({ markExcluded: true });
    if (res.ok && currentIdx < items.length - 1) {
      setTimeout(() => loadItem(currentIdx + 1), 200);
    }
  }, [persist, currentIdx, items.length, loadItem]);

  const handleJumpToUnsaved = useCallback(async () => {
    await persist({});
    const startFrom = currentIdx + 1;
    let target = items.slice(startFrom).findIndex((s) => !s.review_saved);
    if (target >= 0) target += startFrom;
    else target = items.findIndex((s) => !s.review_saved);
    if (target >= 0) {
      loadItem(target);
    } else {
      alert("모든 샘플이 저장 완료 상태입니다.");
    }
  }, [currentIdx, items, persist, loadItem]);

  const handleResetOph = useCallback(() => {
    if (!currentItem) return;
    if (!confirm("편집한 OPH를 버리고 원본으로 되돌립니다.\n계속할까요?"))
      return;
    setDraft((d) => ({ ...d, oph: currentItem.oph_record }));
  }, [currentItem]);

  const handleResetGt = useCallback(() => {
    if (!currentItem) return;
    if (!confirm("편집한 GT를 버리고 원본(초안)으로 되돌립니다.\n계속할까요?"))
      return;
    setDraft((d) => ({ ...d, gt: currentItem.gt }));
  }, [currentItem]);

  const handleLogout = useCallback(async () => {
    await persist({});
    await supabase.auth.signOut();
    router.push("/login");
  }, [persist, supabase, router]);

  // ---------- 통계 ----------
  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((s) => s.review_saved).length;
    const excluded = items.filter((s) => s.review_excluded).length;
    const valid = done - excluded;
    const edited = items.filter((s) => s.gt_edited || s.oph_edited).length;
    return { total, done, valid, excluded, edited };
  }, [items]);

  // ---------- 렌더 ----------
  if (items.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">배정된 샘플이 없습니다</h1>
          {reviewer.is_admin ? (
            <>
              <p className="text-gray-600 text-sm mb-4">
                관리자 페이지에서 CSV를 임포트하세요. 임포트되면 모든
                리뷰어에게 자동 배정됩니다.
              </p>
              <a
                href="/admin"
                className="inline-block mb-4 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                → 관리자 페이지로 이동
              </a>
              <div>
                <button
                  onClick={handleLogout}
                  className="text-sm text-blue-600 hover:underline"
                >
                  로그아웃
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-gray-600 text-sm mb-4">
                아직 임포트된 샘플이 없습니다. 관리자에게 문의하세요.
              </p>
              <button
                onClick={handleLogout}
                className="text-sm text-blue-600 hover:underline"
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <GuideBox open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />

      {/* 툴바 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm">
        <span className="text-gray-600 mr-2">
          <strong>{reviewer.display_name || reviewer.email}</strong>
          {reviewer.is_admin && (
            <span className="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
              admin
            </span>
          )}
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-700">
          {currentIdx + 1} / {stats.total} · 완료 {stats.done} · 유효{" "}
          {stats.valid} · 수정 {stats.edited} · 제외 {stats.excluded}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <SaveStatusIndicator status={saveStatus} error={saveError} />

          <button
            onClick={handlePrev}
            disabled={currentIdx === 0 || loading}
            className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
          >
            ← 이전
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
          >
            저장
          </button>
          <button
            onClick={handleNext}
            disabled={currentIdx >= items.length - 1 || loading}
            className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
          >
            다음 →
          </button>
          <button
            onClick={handleJumpToUnsaved}
            disabled={loading}
            className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
          >
            다음 미저장
          </button>
          <button
            onClick={handleExclude}
            disabled={loading}
            className="px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-40"
          >
            제외
          </button>
          <button
            onClick={() => setNoteOpen((v) => !v)}
            className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
          >
            메모 {noteOpen ? "▶" : "◀"}
          </button>
          {reviewer.is_admin && (
            <a
              href="/admin"
              className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              Admin
            </a>
          )}
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-gray-600 hover:text-gray-900"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* Meta */}
      {currentItem && (
        <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong>Row:</strong> {currentIdx + 1}
          </span>
          {currentItem.patient_id && (
            <span>
              <strong>환자 ID:</strong> {currentItem.patient_id}
            </span>
          )}
          {currentItem.author && (
            <span>
              <strong>작성의:</strong> {currentItem.author}
            </span>
          )}
          <span>
            <strong>Saved:</strong>{" "}
            {currentItem.review_saved ? (
              <span className="text-green-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>OPH edited:</strong>{" "}
            {draft.oph !== currentItem.oph_record ? (
              <span className="text-amber-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>GT edited:</strong>{" "}
            {draft.gt !== currentItem.gt ? (
              <span className="text-amber-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>Excluded:</strong>{" "}
            {currentItem.review_excluded ? (
              <span className="text-red-700">Y</span>
            ) : (
              "N"
            )}
          </span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          items={items}
          currentIdx={currentIdx}
          onSelect={async (idx) => {
            await persist({});
            loadItem(idx);
          }}
        />

        <div className="flex-1 flex overflow-hidden">
          <EditorPanel
            title="OPH Record  (편집 가능)"
            value={draft.oph}
            onChange={(v) => setDraft((d) => ({ ...d, oph: v }))}
            onReset={handleResetOph}
            disabled={loading || !currentItem}
          />
          <EditorPanel
            title="GT  (편집 가능)"
            value={draft.gt}
            onChange={(v) => setDraft((d) => ({ ...d, gt: v }))}
            onReset={handleResetGt}
            disabled={loading || !currentItem}
          />
        </div>

        {noteOpen && (
          <NotePanel
            value={draft.note}
            onChange={(v) => setDraft((d) => ({ ...d, note: v }))}
            onClose={() => setNoteOpen(false)}
            disabled={loading || !currentItem}
          />
        )}
      </div>
    </div>
  );
}

// =========================================================================
// 서브 컴포넌트 (이전과 거의 동일 — 이름만 sample → item으로 바뀜)
// =========================================================================

function findFirstUnsavedIdx(items: AssignmentListItem[]): number {
  const i = items.findIndex((s) => !s.review_saved);
  return i >= 0 ? i : 0;
}

function SaveStatusIndicator({
  status,
  error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (status === "saving")
    return <span className="text-xs text-gray-500">저장 중...</span>;
  if (status === "saved")
    return <span className="text-xs text-green-600">✓ 저장됨</span>;
  if (status === "error")
    return (
      <span className="text-xs text-red-600" title={error ?? undefined}>
        ✗ 저장 실패
      </span>
    );
  return null;
}

function GuideBox({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">
            참고: 작성 가이드 & 샘플 예시
          </span>
          <span className="text-xs text-gray-500">
            빨간 굵은 글씨는 채워넣을 자리(placeholder)입니다.
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
        >
          {open ? "가이드 숨기기 ▲" : "가이드 보기 ▼"}
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-4 px-4 pb-3">
          <GuideBoxPane title="① 기본 포맷" text={FORMAT_TEMPLATE} />
          <GuideBoxPane title="② 샘플 예시" text={EXAMPLE_TEXT} />
        </div>
      )}
    </div>
  );
}

function GuideBoxPane({ title, text }: { title: string; text: string }) {
  const parts = parseMarkdownBold(text);
  return (
    <div>
      <div className="text-sm font-semibold mb-1">{title}</div>
      <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
        {parts.map((p, i) =>
          p.bold ? (
            <span key={i} className="font-bold text-red-600">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

function Sidebar({
  items,
  currentIdx,
  onSelect,
}: {
  items: AssignmentListItem[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${currentIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [currentIdx]);

  return (
    <div className="w-20 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="px-2 py-1 text-xs text-gray-500 border-b border-gray-100">
        No.
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {items.map((s, idx) => {
          const isCurrent = idx === currentIdx;
          let bg = "bg-white text-gray-900";
          if (isCurrent) bg = "bg-blue-300 text-gray-900";
          else if (s.review_excluded) bg = "bg-red-200 text-red-900";
          else if (s.gt_edited || s.oph_edited)
            bg = "bg-amber-100 text-gray-900";
          else if (s.review_saved) bg = "bg-gray-200 text-gray-500";
          return (
            <button
              key={s.id}
              data-idx={idx}
              onClick={() => onSelect(idx)}
              className={`w-full px-2 py-1 text-xs font-mono text-left ${bg} hover:brightness-95 transition`}
            >
              {String(idx + 1).padStart(3, "0")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditorPanel({
  title,
  value,
  onChange,
  onReset,
  disabled,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0">
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
        <span className="text-sm font-semibold">{title}</span>
        <button
          onClick={onReset}
          disabled={disabled}
          className="text-xs px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
        >
          원본 복원
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        className="editor-textarea flex-1 w-full px-4 py-3 text-[15px] bg-white outline-none resize-none disabled:bg-gray-50"
      />
    </div>
  );
}

function NotePanel({
  value,
  onChange,
  onClose,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <div className="w-80 flex flex-col border-l border-gray-200 bg-yellow-50">
      <div className="flex items-center justify-between px-3 py-2 bg-yellow-100 border-b border-yellow-200">
        <span className="text-sm font-semibold">📝 이 샘플에 대한 메모</span>
        <button
          onClick={onClose}
          className="text-xs px-2 py-0.5 border border-yellow-300 rounded hover:bg-yellow-200"
        >
          닫기 ×
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="이 샘플에 대한 메모를 자유롭게 남기세요.&#10;예) 애매한 케이스, 재확인 필요, 논의 필요 등"
        className="editor-textarea flex-1 w-full px-3 py-3 text-sm bg-yellow-50 outline-none resize-none disabled:bg-gray-100"
      />
      <div className="px-3 py-1.5 text-xs text-yellow-800 bg-yellow-100 border-t border-yellow-200">
        저장/이전/다음 클릭 시 함께 저장됩니다.
      </div>
    </div>
  );
}
