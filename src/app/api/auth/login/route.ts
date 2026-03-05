import { NextRequest, NextResponse } from 'next/server'
import { login } from '@/lib/eclass/auth'
import { getSession } from '@/lib/session'

// In-memory rate limiter: IP당 1분에 최대 5회
const attempts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  if (entry.count >= RATE_LIMIT) return true
  entry.count++
  return false
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  const { studentId, password } = await req.json()

  if (!studentId || !password) {
    return NextResponse.json({ error: '학번과 비밀번호를 입력해주세요' }, { status: 400 })
  }

  let result
  try {
    result = await login(String(studentId), String(password))
  } catch (e) {
    console.error('[login] 로그인 오류:', e)
    return NextResponse.json({ error: '로그인 중 오류가 발생했습니다' }, { status: 500 })
  }

  if (!result.success) {
    return NextResponse.json({ error: '학번 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })
  }

  const session = await getSession()
  session.isLoggedIn = true
  session.token = result.token!
  session.userId = result.userId!
  session.studentId = studentId
  await session.save()

  return NextResponse.json({ success: true })
}
