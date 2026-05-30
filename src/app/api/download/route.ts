import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSession } from '@/lib/session'
import { CookieJar } from '@/lib/cookie-jar'

// Vercel 함수 최대 실행 시간. commons 해석/Canvas 재로그인+다운로드를 한 요청에서 처리.
export const maxDuration = 60

const MEDLMS_BASE = 'https://medlms.sch.ac.kr'
const COMMONS_BASE = 'https://commons.sch.ac.kr'
const ALLOWED_HOSTS = ['medlms.sch.ac.kr', 'commons.sch.ac.kr', 'eclass.sch.ac.kr', 'sso.sch.ac.kr']
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

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

// ── 단순 인증 fetch (commons 파일, verifier 있는 medlms 파일용) ─────────
// 매 hop마다 인증 쿠키 포함, 리다이렉트 수동 추적.
async function fetchWithAuth(startUrl: string, token: string, commonsCookie: string): Promise<Response> {
  let currentUrl = startUrl
  for (let i = 0; i < 10; i++) {
    const isCommons = new URL(currentUrl).hostname.includes('commons.sch.ac.kr')
    const cookie = isCommons && commonsCookie ? `${commonsCookie}; xn_api_token=${token}` : `xn_api_token=${token}`
    const resp = await fetch(currentUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: cookie,
        'User-Agent': UA,
        Referer: `${MEDLMS_BASE}/learningx/dashboard`,
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

async function fetchWithRetry(url: string, token: string, commonsCookie: string, retries = 2): Promise<Response> {
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

// ── Canvas 재로그인 다운로드 (강의콘텐츠/과제 본문 첨부 = verifier 없는 medlms 파일) ──
// 다운로드 요청이 SSO 바운스를 거쳐 도달하는 /learningx/login?result= 페이지에는
// RSA 개인키와 암호화된 Canvas 비번이 박혀 있다. 이를 복호화해 /login/canvas에
// 제출하면 Canvas 세션이 서고, 그 뒤 다운로드가 통한다.

// 쿠키를 누적하며 리다이렉트를 끝까지 따라가고, 최종 Response(본문 미소비)를 반환한다.
async function followWithJar(
  startUrl: string,
  jar: CookieJar,
  opts: { method?: string; body?: string; referer?: string } = {},
): Promise<Response> {
  let url = startUrl
  let method = (opts.method ?? 'GET').toUpperCase()
  let body = opts.body
  for (let i = 0; i < 15; i++) {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: jar.header(),
    }
    if (opts.referer) headers.Referer = opts.referer
    if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded'

    const resp = await fetch(url, { method, body: method === 'GET' ? undefined : body, redirect: 'manual', headers })

    const setCookies =
      typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : []
    jar.update(setCookies)

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get('location')
      if (!loc) return resp
      url = new URL(loc, url).href
      if ([301, 302, 303].includes(resp.status)) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    return resp
  }
  throw new Error('Too many redirects')
}

// 페이지에 박힌 RSA 개인키로 Canvas 비번 blob을 복호화 (JSEncrypt = PKCS1 v1.5)
function rsaDecryptPassword(blobB64: string, keyRaw: string): string {
  const b = keyRaw.replace(/-----(BEGIN|END) RSA PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${(b.match(/.{1,64}/g) ?? []).join('\n')}\n-----END RSA PRIVATE KEY-----\n`
  return crypto
    .privateDecrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(blobB64, 'base64'))
    .toString('utf8')
}

async function canvasDownload(
  downloadUrl: string,
  token: string,
  authCookie: string,
  studentId: string,
  dbg?: string[],
): Promise<Response> {
  const jar = new CookieJar()
  if (authCookie) jar.seed(authCookie)
  jar.seed(`xn_api_token=${token}`)
  dbg?.push(`seed cookies: ${authCookie ? authCookie.split(';').length : 0}+token`)

  // 1차: 바로 파일이 나오면 끝, 아니면 result 로그인 페이지
  let resp = await followWithJar(downloadUrl, jar, { referer: `${MEDLMS_BASE}/learningx/dashboard` })
  const ct = resp.headers.get('content-type') ?? ''
  dbg?.push(`1차: ${resp.status} ${ct.slice(0, 20)} url=${resp.url.slice(0, 50)}`)
  if (!ct.includes('text/html')) return resp

  const html = await resp.text()
  const m = html.match(/window\.loginCryption\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/)
  dbg?.push(`loginCryption: ${m ? 'found' : 'NOT FOUND'} (html ${html.length}B)`)
  if (!m) return new Response(null, { status: 401 }) // SSO 만료 등

  let password: string
  try {
    password = rsaDecryptPassword(m[1], m[2])
    dbg?.push(`decrypt ok: pwlen=${password.length}`)
  } catch (e) {
    dbg?.push(`decrypt FAIL: ${e instanceof Error ? e.message : e}`)
    return new Response(null, { status: 502 })
  }

  // 2차: Canvas 세션 수립
  const form = new URLSearchParams({
    utf8: '✓',
    redirect_to_ssl: '1',
    after_login_url: '',
    'pseudonym_session[unique_id]': studentId,
    'pseudonym_session[password]': password,
    'pseudonym_session[remember_me]': '0',
  }).toString()
  const canvasResp = await followWithJar(`${MEDLMS_BASE}/login/canvas`, jar, { method: 'POST', body: form })
  dbg?.push(`2차 canvas: ${canvasResp.status} url=${canvasResp.url.slice(0, 50)}`)

  // 3차: 다시 다운로드 → 이제 파일
  const final = await followWithJar(downloadUrl, jar, { referer: `${MEDLMS_BASE}/learningx/dashboard` })
  dbg?.push(`3차: ${final.status} ${(final.headers.get('content-type') ?? '').slice(0, 20)}`)
  return final
}

// ── commons content.php 해석 ────────────────────────────────────────
function isCommonsContentPhp(url: string): boolean {
  return url.includes('commons.sch.ac.kr') && url.includes('/uniplayer_support/content.php')
}

// verifier 없는 medlms 파일 → Canvas 재로그인 경로 필요
function needsCanvas(url: string): boolean {
  return (
    url.includes('medlms.sch.ac.kr') &&
    url.includes('/files/') &&
    url.includes('/download') &&
    !url.includes('verifier=')
  )
}

type CommonsTarget =
  | { kind: 'file'; url: string }
  | { kind: 'video'; url: string }

async function resolveCommons(contentPhpUrl: string, token: string, commonsCookie: string): Promise<CommonsTarget> {
  const resp = await fetchWithRetry(contentPhpUrl, token, commonsCookie)
  if (!resp.ok) throw new Error(`commons 정보 조회 실패 (${resp.status})`)
  const xml = await resp.text()

  const dl = xml.match(/<content_download_uri>([^<]+)<\/content_download_uri>/)
  if (dl?.[1]) return { kind: 'file', url: COMMONS_BASE + dl[1].replace(/&amp;/g, '&') }

  const tok = xml.match(/auth_value="([^"]+)"[^>]*>([^<]+\.mp4)</)
  if (tok?.[1]) {
    const token2 = tok[1]
    let path = ''
    try {
      const payload = JSON.parse(Buffer.from(token2.split('.')[1], 'base64url').toString('utf8'))
      if (typeof payload.path === 'string') path = payload.path
    } catch {
      /* fallback 아래 */
    }
    if (path) return { kind: 'video', url: `${COMMONS_BASE}${path}?token=${token2}` }
    if (tok[2].startsWith('http')) {
      const media = tok[2].replace(/&amp;/g, '&')
      return { kind: 'video', url: `${media}${media.includes('?') ? '&' : '?'}token=${token2}` }
    }
  }

  throw new Error('이 콘텐츠는 직접 다운로드를 지원하지 않습니다 (medlms에서 확인해주세요)')
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
  const debug = req.nextUrl.searchParams.get('debug') === '1'
  const dbg: string[] = []

  if (!isAllowedHost(url)) {
    return NextResponse.json({ error: '허용되지 않는 도메인입니다' }, { status: 403 })
  }

  let resp: Response
  try {
    if (isCommonsContentPhp(url)) {
      // commons: content.php 해석 (영상은 직링크 redirect, 파일은 프록시)
      const target = await resolveCommons(url, session.token, session.commonsCookie ?? '')
      if (target.kind === 'video') {
        return NextResponse.json({ redirect: target.url })
      }
      resp = await fetchWithRetry(target.url, session.token, session.commonsCookie ?? '')
    } else if (needsCanvas(url)) {
      // 강의콘텐츠/과제 본문 첨부: Canvas 재로그인 후 다운로드
      dbg.push(`authCookie len=${(session.authCookie ?? '').length}, studentId=${session.studentId ? 'set' : 'MISSING'}`)
      resp = await canvasDownload(url, session.token, session.authCookie ?? '', session.studentId, dbg)
    } else {
      // verifier 있는 medlms 파일, 게시판 첨부 등
      resp = await fetchWithRetry(url, session.token, session.commonsCookie ?? '')
    }
  } catch (e) {
    if (debug) return NextResponse.json({ error: String(e), dbg }, { status: 200 })
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '파일 다운로드 실패' },
      { status: 502 },
    )
  }

  if (debug) {
    return NextResponse.json({
      finalStatus: resp.status,
      finalContentType: resp.headers.get('content-type'),
      contentLength: resp.headers.get('content-length'),
      dbg,
    })
  }

  if (resp.status === 401) {
    return NextResponse.json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 })
  }
  if (!resp.ok) {
    return NextResponse.json({ error: `파일 다운로드 실패 (${resp.status})` }, { status: resp.status })
  }

  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream'
  if (contentType.startsWith('text/html')) {
    return NextResponse.json({ error: '파일 다운로드 실패 (인증 만료 — 다시 로그인해주세요)' }, { status: 401 })
  }

  let contentDisposition: string
  if (filename) {
    contentDisposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  } else {
    contentDisposition = resp.headers.get('content-disposition') ?? 'attachment'
  }

  return new NextResponse(resp.body, {
    headers: { 'Content-Type': contentType, 'Content-Disposition': contentDisposition },
  })
}
