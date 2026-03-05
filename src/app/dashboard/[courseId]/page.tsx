'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Attachment {
  file_id: string
  filename: string
  url: string
  uploaded_at: string
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

  function downloadFile(file: Attachment) {
    const proxyUrl = `/api/download?url=${encodeURIComponent(file.url)}`
    const a = document.createElement('a')
    a.href = proxyUrl
    a.download = file.filename
    a.click()
  }

  async function downloadSelected() {
    const targets = files.filter((f) => selected.has(f.file_id))
    for (const file of targets) {
      setDownloading((prev) => new Set(prev).add(file.file_id))
      downloadFile(file)
      // 연속 다운로드 시 브라우저 제한 방지
      await new Promise((r) => setTimeout(r, 800))
      setDownloading((prev) => {
        const next = new Set(prev)
        next.delete(file.file_id)
        return next
      })
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
            파일 목록 불러오는 중... (강의에 따라 최대 30초 소요)
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
                      {file.uploaded_at && (
                        <p className="text-xs text-slate-500">
                          {file.uploaded_at.slice(0, 10)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={downloading.has(file.file_id)}
                      title="다운로드"
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
                    >
                      {downloading.has(file.file_id) ? '⏳' : '⬇'}
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
