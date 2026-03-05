'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? '로그인 실패')
      } else {
        router.push('/dashboard')
      }
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">SCH Eclass</h1>
          <p className="mt-1 text-sm text-slate-400">강의 자료 다운로더</p>
        </div>

        <form onSubmit={handleLogin} className="rounded-xl bg-slate-800 p-6 shadow-xl">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm text-slate-300" htmlFor="studentId">
              학번
            </label>
            <input
              id="studentId"
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="20231234"
              required
              className="w-full rounded-lg bg-slate-700 px-3 py-2.5 text-white placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-blue-500"
            />
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm text-slate-300" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg bg-slate-700 px-3 py-2.5 text-white placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          학번/비밀번호는 서버에 저장되지 않습니다
        </p>
      </div>
    </div>
  )
}
