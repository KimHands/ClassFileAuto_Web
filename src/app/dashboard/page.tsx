'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Course {
  id: string
  name: string
  semester: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/courses')
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/')
          return
        }
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error ?? '강의 목록 조회 실패')
        }
        return res.json()
      })
      .then((data) => {
        if (data) setCourses(data)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  // 학기별 그룹핑
  const bySemester = courses.reduce<Record<string, Course[]>>((acc, c) => {
    const key = c.semester || '기타'
    ;(acc[key] = acc[key] ?? []).push(c)
    return acc
  }, {})

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="font-bold text-white">SCH Eclass 다운로더</span>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && (
          <div className="text-center text-slate-400">강의 목록 불러오는 중...</div>
        )}

        {error && (
          <div className="rounded-xl bg-red-900/40 p-4 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && (
          <>
            {Object.entries(bySemester).map(([semester, list]) => (
              <section key={semester} className="mb-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {semester}
                </h2>
                <ul className="space-y-2">
                  {list.map((course) => (
                    <li key={course.id}>
                      <Link
                        href={`/dashboard/${course.id}`}
                        className="flex items-center justify-between rounded-xl bg-slate-800 px-4 py-3.5 transition hover:bg-slate-700"
                      >
                        <span className="text-sm font-medium text-white">{course.name}</span>
                        <span className="text-xs text-slate-400">파일 보기 →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {courses.length === 0 && (
              <p className="text-center text-slate-400">수강 중인 강의가 없습니다</p>
            )}
          </>
        )}
      </main>
    </div>
  )
}
