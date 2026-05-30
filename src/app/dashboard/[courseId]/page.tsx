'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Attachment {
  file_id: string
  filename: string
  url: string
  uploaded_at: string
  via?: 'proxy' | 'browser'
}

type Kind = 'file' | 'video' | 'medlms'

const VIDEO_EXT = ['.mp4', '.movie', '.zoom', '.avi', '.mov', '.mkv', '.wmv', '.m4v']

// 다운로드 방식 분류:
//  file   → 서버 프록시로 받아 저장 (일괄 다운로드 가능)
//  video  → 대용량 영상, 서명 직링크를 새 탭에서 (일괄 불가)
//  medlms → Canvas 본문 첨부, medlms 새 탭에서 (일괄 불가)
function kindOf(f: Attachment): Kind {
  if (f.via === 'browser') return 'medlms'
  const lower = f.filename.toLowerCase()
  if (VIDEO_EXT.some((e) => lower.endsWith(e))) return 'video'
  return 'file'
}

function ext(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

// 확장자별 색상 뱃지 (다크 테마 톤 유지)
function typeBadge(filename: string): { label: string; cls: string } {
  const e = ext(filename)
  const map: Record<string, { label: string; cls: string }> = {
    pdf: { label: 'PDF', cls: 'bg-red-500/15 text-red-300' },
    hwp: { label: 'HWP', cls: 'bg-sky-500/15 text-sky-300' },
    hwpx: { label: 'HWP', cls: 'bg-sky-500/15 text-sky-300' },
    doc: { label: 'DOC', cls: 'bg-blue-500/15 text-blue-300' },
    docx: { label: 'DOC', cls: 'bg-blue-500/15 text-blue-300' },
    ppt: { label: 'PPT', cls: 'bg-orange-500/15 text-orange-300' },
    pptx: { label: 'PPT', cls: 'bg-orange-500/15 text-orange-300' },
    xls: { label: 'XLS', cls: 'bg-emerald-500/15 text-emerald-300' },
    xlsx: { label: 'XLS', cls: 'bg-emerald-500/15 text-emerald-300' },
    zip: { label: 'ZIP', cls: 'bg-yellow-500/15 text-yellow-300' },
    fig: { label: 'FIG', cls: 'bg-pink-500/15 text-pink-300' },
  }
  if (VIDEO_EXT.some((x) => `.${e}` === x)) return { label: '영상', cls: 'bg-purple-500/15 text-purple-300' }
  return map[e] ?? { label: (e || 'FILE').toUpperCase().slice(0, 4), cls: 'bg-slate-600/30 text-slate-300' }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function CourseFilesPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = use(params)
  const router = useRouter()
  const [files, setFiles] = useState<Attachment[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map())
  const [bulk, setBulk] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  })
  const [openNotice, setOpenNotice] = useState(0)

  useEffect(() => {
    fetch(`/api/courses/${courseId}/files`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/')
          return
        }
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error ?? '파일 목록 조회 실패')
        }
        return res.json()
      })
      .then((data) => {
        if (data) {
          setFiles(data)
          setSelected(new Set(data.map((f: Attachment) => f.file_id)))
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [courseId, router])

  const hasOpenKind = files.some((f) => kindOf(f) !== 'file')

  function toggleFile(fileId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(fileId) ? next.delete(fileId) : next.add(fileId)
      return next
    })
  }

  function toggleAll() {
    setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.file_id)))
  }

  function setFileError(id: string, msg: string | null) {
    setFileErrors((prev) => {
      const next = new Map(prev)
      msg ? next.set(id, msg) : next.delete(id)
      return next
    })
  }

  function markDone(id: string) {
    setDoneIds((prev) => new Set(prev).add(id))
  }

  // 단일 파일 처리. file은 받아서 저장, video/medlms는 새 탭에서 연다.
  async function handleOne(file: Attachment): Promise<boolean> {
    const kind = kindOf(file)
    setFileError(file.file_id, null)

    if (kind === 'medlms') {
      window.open(file.url, '_blank', 'noopener')
      markDone(file.file_id)
      return true
    }

    setDownloading((prev) => new Set(prev).add(file.file_id))
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(file.url)}&filename=${encodeURIComponent(file.filename)}`
      const res = await fetch(proxyUrl)

      // 다운로드 401은 그 파일만 실패 처리한다 (로그아웃·페이지 이동 금지).
      if (res.status === 401) {
        setFileError(file.file_id, '받을 수 없는 파일입니다 (인증). 새로고침 후 다시 시도해보세요.')
        return false
      }

      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const d = await res.json().catch(() => ({}))
        if (res.ok && d.redirect) {
          window.open(d.redirect, '_blank', 'noopener') // 영상: 새 탭
          markDone(file.file_id)
          return true
        }
        setFileError(file.file_id, d.error ?? `다운로드 실패 (${res.status})`)
        return false
      }

      if (!res.ok) {
        setFileError(file.file_id, `다운로드 실패 (${res.status})`)
        return false
      }

      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
      markDone(file.file_id)
      return true
    } catch {
      setFileError(file.file_id, '네트워크 오류로 실패했습니다. 잠시 후 다시 시도해주세요.')
      return false
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev)
        next.delete(file.file_id)
        return next
      })
    }
  }

  // 선택 다운로드:
  //  - medlms 본문첨부(text_): 직접 다운로드 URL이라 클릭 제스처 내에서 바로 새 탭으로 연다
  //  - 실제 파일: 서버 프록시로 순차 다운로드 (진행률)
  //  - 영상: 서버에서 서명 URL을 해석해야 해(async) 일괄로 못 열어 개별 안내
  // #5 동작 복구: 선택한 파일을 형식 구분 없이 그대로 순회 처리한다.
  // (file → 서버 다운로드, medlms 본문첨부 → 새 탭, video → 서명 직링크 새 탭)
  async function downloadSelected() {
    const targets = files.filter((f) => selected.has(f.file_id))
    setBulk({ active: true, done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i++) {
      await handleOne(targets[i])
      setBulk({ active: true, done: i + 1, total: targets.length })
      await sleep(500)
    }
    setBulk({ active: false, done: 0, total: 0 })
  }

  const allSelected = selected.size === files.length && files.length > 0

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href="/dashboard"
            className="rounded-lg px-2 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            ← 강의 목록
          </Link>
          <span className="text-sm font-semibold text-white">강의 자료</span>
          {!loading && !error && (
            <span className="ml-auto text-xs text-slate-500">{files.length}개</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {loading && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-800/60" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-800/50 bg-red-900/30 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* 액션 바 */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    allSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-600'
                  }`}
                >
                  {allSelected && <span className="text-[10px] text-white">✓</span>}
                </span>
                {allSelected ? '전체 해제' : '전체 선택'}
              </button>

              <button
                onClick={downloadSelected}
                disabled={selected.size === 0 || bulk.active}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bulk.active ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    다운로드 중 {bulk.done}/{bulk.total}
                  </>
                ) : (
                  <>선택 다운로드 ({selected.size})</>
                )}
              </button>
            </div>

            {/* 일괄 완료 후 ↗ 파일 안내 */}
            {openNotice > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-900/25 px-3 py-2 text-xs text-amber-200/90">
                <span>↗</span>
                <span>
                  영상 <b>{openNotice}개</b>는 서버가 미리 받아둘 수 없어, 아래 목록에서{' '}
                  <b>↗ 버튼을 하나씩</b> 눌러 새 탭에서 받아주세요.
                </span>
              </div>
            )}

            {/* ↗ 안내 배너 */}
            {hasOpenKind && openNotice === 0 && (
              <p className="mb-3 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
                <span className="text-amber-300/90">↗</span> 표시(영상·강의콘텐츠 본문 첨부)는 서버가 대신 받을 수 없어
                medlms 새 탭에서 열립니다. 여러 개를 한꺼번에 받으면 브라우저가 <b>팝업 허용</b>을 물을 수 있어요.
              </p>
            )}

            {/* 파일 목록 */}
            {files.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 py-12 text-center text-sm text-slate-500">
                파일이 없습니다
              </div>
            ) : (
              <ul className="space-y-1.5">
                {files.map((file) => {
                  const kind = kindOf(file)
                  const badge = typeBadge(file.filename)
                  const isSel = selected.has(file.file_id)
                  const isDown = downloading.has(file.file_id)
                  const isDone = doneIds.has(file.file_id)
                  const err = fileErrors.get(file.file_id)
                  return (
                    <li
                      key={file.file_id}
                      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                        isSel
                          ? 'border-blue-500/30 bg-slate-800/70'
                          : 'border-transparent bg-slate-800/40 hover:bg-slate-800/70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleFile(file.file_id)}
                        className="h-4 w-4 shrink-0 accent-blue-500"
                      />

                      {/* 형식 뱃지 */}
                      <span
                        className={`hidden h-9 w-11 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold sm:flex ${badge.cls}`}
                      >
                        {badge.label}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-100">{file.filename}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          {file.uploaded_at && (
                            <span className="text-slate-500">{file.uploaded_at.slice(0, 10)}</span>
                          )}
                          {kind === 'video' && <span className="text-purple-300/80">영상 · 새 탭</span>}
                          {kind === 'medlms' && <span className="text-amber-300/80">medlms에서 열림</span>}
                          {err && <span className="text-red-400">⚠ {err}</span>}
                        </div>
                      </div>

                      {/* 액션 버튼 */}
                      <button
                        onClick={() => handleOne(file)}
                        disabled={isDown}
                        title={kind === 'file' ? '다운로드' : '새 탭에서 열기'}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40 ${
                          isDone ? 'text-emerald-400' : ''
                        }`}
                      >
                        {isDown ? (
                          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-white" />
                        ) : isDone ? (
                          '✓'
                        ) : kind === 'file' ? (
                          '⬇'
                        ) : (
                          '↗'
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}
