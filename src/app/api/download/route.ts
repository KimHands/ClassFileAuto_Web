import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

// Vercel Pro: 60초, Hobby: 10초 (제한 있음)
export const maxDuration = 60

const ALLOWED_HOSTS = ['medlms.sch.ac.kr', 'commons.sch.ac.kr', 'eclass.sch.ac.kr', 'sso.sch.ac.kr']

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

// redirect: 'follow'는 크로스 도메인 리다이렉트 시 Cookie를 드랍함.
// 수동으로 리다이렉트를 따라가면서 매 hop마다 인증 쿠키를 포함.
async function fetchWithAuth(startUrl: string, token: string): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Cookie: `xn_api_token=${token}`,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    Referer: 'https://medlms.sch.ac.kr/learningx/dashboard',
  }

  let currentUrl = startUrl
  for (let i = 0; i < 10; i++) {
    console.log(`[download] hop ${i}: GET ${currentUrl}`)
    const resp = await fetch(currentUrl, { headers, redirect: 'manual' })
    console.log(`[download] hop ${i}: status=${resp.status} content-type=${resp.headers.get('content-type')} location=${resp.headers.get('location')}`)

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) break
      const nextUrl = new URL(location, currentUrl).href
      if (!isAllowedHost(nextUrl)) {
        console.log(`[download] 허용 도메인 벗어남, 중단: ${nextUrl}`)
        break
      }
      currentUrl = nextUrl
      continue
    }

    return resp
  }

  throw new Error('리다이렉트 처리 실패')
}

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
  if (!isAllowedHost(url)) {
    return NextResponse.json({ error: '허용되지 않는 도메인입니다' }, { status: 403 })
  }

  const resp = await fetchWithAuth(url, session.token)

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
    // RFC 6266: filename*= 만 사용 (filename=""에 비ASCII 문자 넣으면 헤더 오류 발생)
    const encoded = encodeURIComponent(filename)
    contentDisposition = `attachment; filename*=UTF-8''${encoded}`
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
