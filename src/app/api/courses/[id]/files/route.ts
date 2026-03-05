import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { fetchAttachments } from '@/lib/eclass/crawler'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  const { id } = await params

  try {
    const files = await fetchAttachments(session.token, session.studentId, session.userId, id)
    return NextResponse.json(files)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
