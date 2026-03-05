'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)

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

          {/* 개인정보 제3자 제공 동의 (개인정보보호법 제17조 제1항 제1호) */}
          <div className="mb-4 rounded-lg bg-slate-700/50 p-3 text-xs text-slate-400">
            <p className="mb-2 font-semibold text-slate-300">개인정보 제3자 제공 동의</p>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr className="border-b border-slate-600">
                  <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">제공받는 자</td>
                  <td className="py-1">Vercel Inc. (외부 서버, 일본 도쿄)</td>
                </tr>
                <tr className="border-b border-slate-600">
                  <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">제공 항목</td>
                  <td className="py-1">학번, 비밀번호 (로그인 처리 후 즉시 파기)</td>
                </tr>
                <tr className="border-b border-slate-600">
                  <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">이용 목적</td>
                  <td className="py-1">SCH Eclass 강의자료 다운로드 서비스 제공</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">보유 기간</td>
                  <td className="py-1">세션 유지 시간 (최대 8시간, 서버 미저장)</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-slate-500">
              동의를 거부할 수 있으며, 거부 시 서비스 이용이 불가합니다.
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-500"
              />
              <span className="text-slate-300">위 내용을 확인하였으며, 동의합니다.</span>
            </label>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !agreed}
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
