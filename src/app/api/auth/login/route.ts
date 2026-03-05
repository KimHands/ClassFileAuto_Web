import { NextRequest, NextResponse } from 'next/server'
import { login } from '@/lib/eclass/auth'
import { getSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const { studentId, password } = await req.json()

  if (!studentId || !password) {
    return NextResponse.json({ error: '학번과 비밀번호를 입력해주세요' }, { status: 400 })
  }

  let result
  try {
    result = await login(String(studentId), String(password))
  } catch (e) {
    return NextResponse.json({ error: `로그인 중 오류: ${e}` }, { status: 500 })
  }

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  const session = await getSession()
  session.isLoggedIn = true
  session.token = result.token!
  session.userId = result.userId!
  session.studentId = studentId
  await session.save()

  return NextResponse.json({ success: true })
}
