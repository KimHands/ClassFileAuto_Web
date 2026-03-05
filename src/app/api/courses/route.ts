import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { fetchCourses } from '@/lib/eclass/crawler'

export const revalidate = 300 // 5분 캐시

export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  try {
    const courses = await fetchCourses(session.token, session.userId)
    return NextResponse.json(courses)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
