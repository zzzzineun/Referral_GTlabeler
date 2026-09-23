"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  EXAMPLE_TEXT,
  FORMAT_TEMPLATE,
  parseMarkdownBold,
} from "@/lib/constants";
import type { Reviewer, Sample, SampleListItem } from "@/lib/types";

type Props = {
  reviewer: Reviewer;
  initialSamples: SampleListItem[];
};

// 현재 편집 중인 로컬 상태 (DB에 저장되기 전 임시)
type DraftState = {
  oph: string;
  gt: string;
  note: string;
};

export default function LabelingClient({ reviewer, initialSamples }: Props) {
  const supabase = createClient();
  const router = useRouter();

  const [samples, setSamples] = useState<SampleListItem[]>(initialSamples);
  const [currentIdx, setCurrentIdx] = useState<number>(() =>
    findFirstUnsavedIdx(initialSamples),
  );
  const [currentSample, setCurrentSample] = useState<Sample | null>(null);
  const [draft, setDraft] = useState<DraftState>({ oph: "", gt: "", note: "" });
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [noteOpen, setNoteOpen] = useState(true);

  // 현재 로드된 sample.id — 저장 시 index 대신 이 값으로 안전하게 지정
  const currentSampleIdRef = useRef<number | null>(null);
  // draft 최신 값을 저장 함수에서 읽기 위한 ref
  const draftRef = useRef<DraftState>(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // ---------- 샘플 로드 ----------
  const loadSample = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= samples.length) return;
      const targetId = samples[idx].id;
      setLoading(true);
      setSaveStatus("idle");
      setSaveError(null);

      const { data, error } = await supabase
        .from("samples")
        .select("*")
        .eq("id", targetId)
        .maybeSingle<Sample>();

      setLoading(false);

      if (error || !data) {
        setSaveStatus("error");
        setSaveError(error?.message ?? "샘플을 찾을 수 없습니다");
        return;
      }

      setCurrentSample(data);
      currentSampleIdRef.current = data.id;
      setDraft({
        oph: data.oph_revised ?? data.oph_record,
        gt: data.gt_revised ?? data.gt,
        note: data.reviewer_note ?? "",
      });
      setCurrentIdx(idx);
    },
    [samples, supabase],
  );

  // 마운트 시 첫 샘플 로드
  useEffect(() => {
    if (samples.length > 0) {
      loadSample(currentIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 저장 (공통) ----------
  const persist = useCallback(
    async (opts: {
      markSaved?: boolean;
      markExcluded?: boolean;
    }): Promise<{ ok: boolean; message?: string }> => {
      const sample = currentSample;
      const sampleId = currentSampleIdRef.current;
      if (!sample || sampleId == null) return { ok: false, message: "no sample" };

      const d = draftRef.current;
      const now = new Date().toISOString();

      const ophChanged = d.oph !== (sample.oph_revised ?? sample.oph_record);
      const gtChanged = d.gt !== (sample.gt_revised ?? sample.gt);
      const noteChanged = d.note !== (sample.reviewer_note ?? "");

      const patch: Partial<Sample> & { updated_by?: string } = {
        updated_by: reviewer.id,
      };

      if (ophChanged) {
        patch.oph_revised = d.oph;
        patch.oph_edited = d.oph !== sample.oph_record;
      }
      if (gtChanged) {
        patch.gt_revised = d.gt;
        patch.gt_edited = d.gt !== sample.gt;
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

      // 변경 사항이 하나도 없고 상태 마킹도 없으면 skip
      const nothingToDo =
        !ophChanged &&
        !gtChanged &&
        !noteChanged &&
        !opts.markSaved &&
        !opts.markExcluded;
      if (nothingToDo) return { ok: true };

      setSaveStatus("saving");

      const { error: updateError } = await supabase
        .from("samples")
        .update(patch)
        .eq("id", sampleId);

      if (updateError) {
        setSaveStatus("error");
        setSaveError(updateError.message);
        return { ok: false, message: updateError.message };
      }

      // audit log — 실제로 텍스트가 바뀐 것만 기록
      const logEntries: Array<{
        sample_id: number;
        reviewer_id: string;
        column_name: string;
        before_text: string | null;
        after_text: string;
      }> = [];
      if (ophChanged) {
        logEntries.push({
          sample_id: sampleId,
          reviewer_id: reviewer.id,
          column_name: "oph_record",
          before_text: sample.oph_revised ?? sample.oph_record,
          after_text: d.oph,
        });
      }
      if (gtChanged) {
        logEntries.push({
          sample_id: sampleId,
          reviewer_id: reviewer.id,
          column_name: "gt",
          before_text: sample.gt_revised ?? sample.gt,
          after_text: d.gt,
        });
      }
      if (noteChanged) {
        logEntries.push({
          sample_id: sampleId,
          reviewer_id: reviewer.id,
          column_name: "reviewer_note",
          before_text: sample.reviewer_note ?? "",
          after_text: d.note,
        });
      }
      if (logEntries.length > 0) {
        await supabase.from("edit_logs").insert(logEntries);
      }

      // 로컬 리스트도 즉시 갱신 (색상 반영)
      setSamples((prev) =>
        prev.map((s) =>
          s.id === sampleId
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

      // 현재 sample 로컬 캐시도 갱신
      setCurrentSample((prev) => (prev ? { ...prev, ...patch } as Sample : prev));

      setSaveStatus("saved");
      return { ok: true };
    },
    [currentSample, reviewer.id, supabase],
  );

  // ---------- 액션 버튼들 ----------
  const handlePrev = useCallback(async () => {
    if (currentIdx <= 0) return;
    await persist({ markSaved: false }); // 자동 저장 (완료 표시 없이)
    await loadSample(currentIdx - 1);
  }, [currentIdx, persist, loadSample]);

  const handleNext = useCallback(async () => {
    if (currentIdx >= samples.length - 1) return;
    await persist({ markSaved: false }); // 자동 저장 (완료 표시 없이)
    await loadSample(currentIdx + 1);
  }, [currentIdx, samples.length, persist, loadSample]);

  const handleSave = useCallback(async () => {
    const res = await persist({ markSaved: true });
    if (res.ok) {
      // "저장 완료" 상태를 잠깐 보여주고 다음으로 이동
      setTimeout(() => {
        if (currentIdx < samples.length - 1) {
          loadSample(currentIdx + 1);
        }
      }, 200);
    }
  }, [persist, currentIdx, samples.length, loadSample]);

  const handleExclude = useCallback(async () => {
    if (!confirm("이 샘플을 제외로 표시할까요?")) return;
    const res = await persist({ markExcluded: true });
    if (res.ok && currentIdx < samples.length - 1) {
      setTimeout(() => loadSample(currentIdx + 1), 200);
    }
  }, [persist, currentIdx, samples.length, loadSample]);

  const handleJumpToUnsaved = useCallback(async () => {
    await persist({});
    // 현재 이후의 첫 미저장, 없으면 처음부터
    const startFrom = currentIdx + 1;
    let target = samples.slice(startFrom).findIndex((s) => !s.review_saved);
    if (target >= 0) target += startFrom;
    else target = samples.findIndex((s) => !s.review_saved);
    if (target >= 0) {
      loadSample(target);
    } else {
      alert("모든 샘플이 저장 완료 상태입니다.");
    }
  }, [currentIdx, samples, persist, loadSample]);

  const handleResetOph = useCallback(() => {
    if (!currentSample) return;
    if (!confirm("편집한 OPH를 버리고 원본으로 되돌립니다.\n계속할까요?")) return;
    setDraft((d) => ({ ...d, oph: currentSample.oph_record }));
  }, [currentSample]);

  const handleResetGt = useCallback(() => {
    if (!currentSample) return;
    if (!confirm("편집한 GT를 버리고 원본(초안)으로 되돌립니다.\n계속할까요?")) return;
    setDraft((d) => ({ ...d, gt: currentSample.gt }));
  }, [currentSample]);

  const handleLogout = useCallback(async () => {
    await persist({});
    await supabase.auth.signOut();
    router.push("/login");
  }, [persist, supabase, router]);

  // ---------- 통계 ----------
  const stats = useMemo(() => {
    const total = samples.length;
    const done = samples.filter((s) => s.review_saved).length;
    const excluded = samples.filter((s) => s.review_excluded).length;
    const valid = done - excluded;
    const edited = samples.filter((s) => s.gt_edited || s.oph_edited).length;
    return { total, done, valid, excluded, edited };
  }, [samples]);

  // ---------- 렌더 ----------
  if (samples.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">배정된 샘플이 없습니다</h1>
          {reviewer.is_admin ? (
            <>
              <p className="text-gray-600 text-sm mb-4">
                관리자 페이지에서 CSV를 임포트하고 리뷰어에게 배정하세요.
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
                관리자에게 샘플 배정을 요청하세요.
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

  const currentListItem = samples[currentIdx];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 상단 참고 박스 */}
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
            disabled={currentIdx >= samples.length - 1 || loading}
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
      {currentSample && (
        <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong>Row:</strong> {currentIdx + 1}
          </span>
          {currentSample.patient_id && (
            <span>
              <strong>환자 ID:</strong> {currentSample.patient_id}
            </span>
          )}
          {currentSample.author && (
            <span>
              <strong>작성의:</strong> {currentSample.author}
            </span>
          )}
          <span>
            <strong>Saved:</strong>{" "}
            {currentSample.review_saved ? (
              <span className="text-green-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>OPH edited:</strong>{" "}
            {draft.oph !== currentSample.oph_record ? (
              <span className="text-amber-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>GT edited:</strong>{" "}
            {draft.gt !== currentSample.gt ? (
              <span className="text-amber-700">Y</span>
            ) : (
              "N"
            )}
          </span>
          <span>
            <strong>Excluded:</strong>{" "}
            {currentSample.review_excluded ? (
              <span className="text-red-700">Y</span>
            ) : (
              "N"
            )}
          </span>
        </div>
      )}

      {/* 본문: 좌 사이드바 · 중앙 편집 · (선택) 우 메모 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌 사이드바 */}
        <Sidebar
          samples={samples}
          currentIdx={currentIdx}
          onSelect={async (idx) => {
            await persist({});
            loadSample(idx);
          }}
        />

        {/* 편집 영역 */}
        <div className="flex-1 flex overflow-hidden">
          <EditorPanel
            title="OPH Record  (편집 가능)"
            value={draft.oph}
            onChange={(v) => setDraft((d) => ({ ...d, oph: v }))}
            onReset={handleResetOph}
            disabled={loading || !currentSample}
          />
          <EditorPanel
            title="GT  (편집 가능)"
            value={draft.gt}
            onChange={(v) => setDraft((d) => ({ ...d, gt: v }))}
            onReset={handleResetGt}
            disabled={loading || !currentSample}
          />
        </div>

        {/* 메모장 (토글) */}
        {noteOpen && (
          <NotePanel
            value={draft.note}
            onChange={(v) => setDraft((d) => ({ ...d, note: v }))}
            onClose={() => setNoteOpen(false)}
            disabled={loading || !currentSample}
          />
        )}
      </div>
    </div>
  );
}

// =========================================================================
// 서브 컴포넌트
// =========================================================================

function findFirstUnsavedIdx(samples: SampleListItem[]): number {
  const i = samples.findIndex((s) => !s.review_saved);
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
      <span
        className="text-xs text-red-600"
        title={error ?? undefined}
      >
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
  samples,
  currentIdx,
  onSelect,
}: {
  samples: SampleListItem[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}) {
  // 현재 선택된 항목이 항상 뷰포트에 보이도록 스크롤
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
        {samples.map((s, idx) => {
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
