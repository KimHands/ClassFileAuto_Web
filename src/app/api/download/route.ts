import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

// Vercel 함수 최대 실행 시간. commons 파일은 content.php 해석 + 다운로드를 한 요청에서 처리하므로
// 여유를 둔다. (무료 플랜에서 60이 거부되면 10으로 낮출 것)
export const maxDuration = 60

const COMMONS_BASE = 'https://commons.sch.ac.kr'
const ALLOWED_HOSTS = ['medlms.sch.ac.kr', 'commons.sch.ac.kr', 'eclass.sch.ac.kr', 'sso.sch.ac.kr']

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// redirect: 'follow'는 크로스 도메인 리다이렉트 시 Cookie를 드랍함.
// 수동으로 리다이렉트를 따라가면서 매 hop마다 인증 쿠키를 포함.
async function fetchWithAuth(startUrl: string, token: string, commonsCookie: string): Promise<Response> {
  let currentUrl = startUrl
  for (let i = 0; i < 10; i++) {
    const isCommons = new URL(currentUrl).hostname.includes('commons.sch.ac.kr')
    // commons는 PHP 세션 쿠키 + xn_api_token, 그 외는 xn_api_token만
    const cookie = isCommons && commonsCookie
      ? `${commonsCookie}; xn_api_token=${token}`
      : `xn_api_token=${token}`

    const resp = await fetch(currentUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: cookie,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        Referer: 'https://medlms.sch.ac.kr/learningx/dashboard',
      },
      redirect: 'manual',
    })

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) break
      const nextUrl = new URL(location, currentUrl).href
      if (!isAllowedHost(nextUrl)) break
      currentUrl = nextUrl
      continue
    }

    return resp
  }

  throw new Error('리다이렉트 처리 실패')
}

// 연결 끊김(학교 서버가 간헐적으로 connection을 끊음) 대비 재시도.
// 무료 플랜 10초 한도를 고려해 대기는 짧게.
async function fetchWithRetry(
  url: string,
  token: string,
  commonsCookie: string,
  retries = 2,
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithAuth(url, token, commonsCookie)
      if (resp.status >= 500 && i < retries) {
        await sleep(400)
        continue
      }
      return resp
    } catch (e) {
      lastErr = e
      if (i < retries) await sleep(400)
    }
  }
  throw lastErr ?? new Error('다운로드 요청 실패')
}

function isCommonsContentPhp(url: string): boolean {
  return url.includes('commons.sch.ac.kr') && url.includes('/uniplayer_support/content.php')
}

// commons content.php(XML)에서 실제 다운로드 URL을 해석한다.
async function resolveCommonsUrl(
  contentPhpUrl: string,
  token: string,
  commonsCookie: string,
): Promise<string> {
  const resp = await fetchWithRetry(contentPhpUrl, token, commonsCookie)
  if (!resp.ok) throw new Error(`commons 정보 조회 실패 (${resp.status})`)

  const xml = await resp.text()
  const m = xml.match(/<content_download_uri>([^<]+)<\/content_download_uri>/)
  // XML 엔티티 디코딩 (&amp; → &)
  if (!m?.[1]) throw new Error('commons 다운로드 URL을 찾을 수 없습니다 (파일이 아직 공개되지 않았을 수 있음)')
  return COMMONS_BASE + m[1].replace(/&amp;/g, '&')
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

  // commons 파일은 다운로드 시점에 content.php를 해석해 실제 URL을 얻는다.
  let targetUrl = url
  if (isCommonsContentPhp(url)) {
    try {
      targetUrl = await resolveCommonsUrl(url, session.token, session.commonsCookie ?? '')
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
    }
  }

  let resp: Response
  try {
    resp = await fetchWithRetry(targetUrl, session.token, session.commonsCookie ?? '')
  } catch (e) {
    return NextResponse.json(
      { error: `파일 다운로드 실패 (네트워크 오류): ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  if (!resp.ok) {
    return NextResponse.json({ error: `파일 다운로드 실패 (${resp.status})` }, { status: resp.status })
  }

  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream'

  // 서버가 HTML을 반환하면 인증 실패로 간주 (로그인 리다이렉트 페이지)
  if (contentType.startsWith('text/html')) {
    return NextResponse.json({ error: '파일 다운로드 실패 (인증 만료 — 다시 로그인해주세요)' }, { status: 401 })
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
