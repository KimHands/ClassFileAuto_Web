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
    console.error('[login] 네트워크/런타임 오류:', e)
    return NextResponse.json({ error: '학교 서버에 연결할 수 없습니다. 네트워크 상태를 확인하거나 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }

  if (!result.success) {
    const isCredentialError = result.errorType === 'credentials'
    console.error('[login] 로그인 실패:', result.error)
    return NextResponse.json(
      { error: result.error },
      { status: isCredentialError ? 401 : 502 },
    )
  }

  const session = await getSession()
  session.isLoggedIn = true
  session.token = result.token!
  session.userId = result.userId!
  session.studentId = studentId
  session.sessionCookies = result.sessionCookies ?? ''
  await session.save()

  return NextResponse.json({ success: true })
}
