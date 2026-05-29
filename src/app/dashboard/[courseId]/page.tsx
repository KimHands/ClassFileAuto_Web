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
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map())

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

  function toggleFile(fileId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(fileId) ? next.delete(fileId) : next.add(fileId)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === files.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(files.map((f) => f.file_id)))
    }
  }

  function setFileError(fileId: string, msg: string | null) {
    setFileErrors((prev) => {
      const next = new Map(prev)
      msg ? next.set(fileId, msg) : next.delete(fileId)
      return next
    })
  }

  // fetch로 받아 blob 다운로드. 실패 시 사유를 화면에 표시한다.
  async function downloadFile(file: Attachment): Promise<boolean> {
    // Canvas 직링크(verifier 없음): 서버 프록시 불가 → medlms 새 탭으로 열어 브라우저 세션으로 다운로드
    if (file.via === 'browser') {
      window.open(file.url, '_blank', 'noopener')
      return true
    }
    setDownloading((prev) => new Set(prev).add(file.file_id))
    setFileError(file.file_id, null)
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(file.url)}&filename=${encodeURIComponent(file.filename)}`
      const res = await fetch(proxyUrl)

      if (res.status === 401) {
        router.push('/')
        return false
      }
      if (!res.ok) {
        let msg = `다운로드 실패 (${res.status})`
        try {
          const d = await res.json()
          if (d?.error) msg = d.error
        } catch {
          /* JSON이 아니면 기본 메시지 유지 */
        }
        setFileError(file.file_id, msg)
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
      return true
    } catch {
      setFileError(file.file_id, '네트워크 오류로 다운로드에 실패했습니다. 잠시 후 다시 시도해주세요.')
      return false
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev)
        next.delete(file.file_id)
        return next
      })
    }
  }

  async function downloadSelected() {
    const targets = files.filter((f) => selected.has(f.file_id))
    for (const file of targets) {
      await downloadFile(file)
      // 연속 다운로드 시 브라우저 제한 방지
      await new Promise((r) => setTimeout(r, 600))
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            ← 강의 목록
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && (
          <div className="text-center text-slate-400">
            파일 목록 불러오는 중...
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-900/40 p-4 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* 액션 바 */}
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={toggleAll}
                className="text-sm text-slate-400 hover:text-white"
              >
                {selected.size === files.length ? '전체 해제' : '전체 선택'}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{selected.size}개 선택</span>
                <button
                  onClick={downloadSelected}
                  disabled={selected.size === 0}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
                >
                  선택 다운로드
                </button>
              </div>
            </div>

            {/* medlms 직접 열기 안내 */}
            {files.some((f) => f.via === 'browser') && (
              <p className="mb-3 rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-300/90">
                ↗ 표시 파일은 강의콘텐츠·과제 본문 첨부라 서버가 대신 받을 수 없어, medlms 새 탭에서 열립니다.
                (medlms 로그인이 필요할 수 있어요)
              </p>
            )}

            {/* 파일 목록 */}
            {files.length === 0 ? (
              <p className="text-center text-slate-400">파일이 없습니다</p>
            ) : (
              <ul className="space-y-2">
                {files.map((file) => (
                  <li
                    key={file.file_id}
                    className="flex items-center gap-3 rounded-xl bg-slate-800 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(file.file_id)}
                      onChange={() => toggleFile(file.file_id)}
                      className="h-4 w-4 accent-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{file.filename}</p>
                      <div className="flex items-center gap-2">
                        {file.uploaded_at && (
                          <p className="text-xs text-slate-500">
                            {file.uploaded_at.slice(0, 10)}
                          </p>
                        )}
                        {file.via === 'browser' && (
                          <span className="text-xs text-amber-400/80">medlms에서 열림 ↗</span>
                        )}
                      </div>
                      {fileErrors.has(file.file_id) && (
                        <p className="mt-0.5 text-xs text-red-400">
                          ⚠ {fileErrors.get(file.file_id)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={downloading.has(file.file_id)}
                      title={file.via === 'browser' ? 'medlms에서 열기' : '다운로드'}
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
                    >
                      {downloading.has(file.file_id) ? '⏳' : file.via === 'browser' ? '↗' : '⬇'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}
