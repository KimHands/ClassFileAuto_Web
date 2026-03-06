import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

// Vercel Pro: 60초, Hobby: 10초 (제한 있음)
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url 파라미터가 필요합니다' }, { status: 400 })
  }

  const filename = req.nextUrl.searchParams.get('filename') ?? ''

  // URL 화이트리스트: SCH 도메인만 허용 (SSRF 방지)
  const allowed = ['medlms.sch.ac.kr', 'commons.sch.ac.kr', 'eclass.sch.ac.kr']
  const urlHost = new URL(url).hostname
  if (!allowed.some((h) => urlHost === h || urlHost.endsWith(`.${h}`))) {
    return NextResponse.json({ error: '허용되지 않는 도메인입니다' }, { status: 403 })
  }

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Cookie: `xn_api_token=${session.token}`,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      Referer: 'https://medlms.sch.ac.kr/learningx/dashboard',
    },
    redirect: 'follow',
  })

  if (!resp.ok) {
    return NextResponse.json({ error: `파일 다운로드 실패 (${resp.status})` }, { status: resp.status })
  }

  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream'

  // 서버가 HTML을 반환하면 인증 실패로 간주 (로그인 리다이렉트 페이지)
  if (contentType.startsWith('text/html')) {
    return NextResponse.json({ error: '파일 다운로드 실패 (인증 오류)' }, { status: 401 })
  }

  // filename 파라미터가 있으면 직접 Content-Disposition 설정 (서버 헤더 무시)
  // → 서버의 깨진 한글 파일명이나 inline disposition 문제 방지
  let contentDisposition: string
  if (filename) {
    const encoded = encodeURIComponent(filename)
    contentDisposition = `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`
  } else {
    contentDisposition = resp.headers.get('content-disposition') ?? 'attachment'
  }

  // 스트리밍으로 브라우저에 전달
  return new NextResponse(resp.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
    },
  })
}
