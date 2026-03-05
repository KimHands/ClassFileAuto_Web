import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { fetchAttachments, fetchCourses } from '@/lib/eclass/crawler'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  const { id } = await params

  // courseId 형식 검증
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: '잘못된 강의 ID입니다' }, { status: 400 })
  }

  // 소유권 검증: 본인이 수강 중인 강의인지 확인
  let courses
  try {
    courses = await fetchCourses(session.token, session.userId)
  } catch (e) {
    console.error('[files] 강의 목록 조회 오류:', e)
    return NextResponse.json({ error: '강의 목록을 확인할 수 없습니다' }, { status: 500 })
  }

  if (!courses.some((c) => c.id === id)) {
    return NextResponse.json({ error: '접근 권한이 없는 강의입니다' }, { status: 403 })
  }

  try {
    const files = await fetchAttachments(session.token, session.studentId, session.userId, id)
    return NextResponse.json(files)
  } catch (e) {
    console.error('[files] 파일 목록 조회 오류:', e)
    return NextResponse.json({ error: '파일 목록을 불러오는 중 오류가 발생했습니다' }, { status: 500 })
  }
}
