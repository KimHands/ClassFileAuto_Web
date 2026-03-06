/**
 * Python auth.py의 EclassAuth를 TypeScript로 포팅.
 *
 * 인증 흐름:
 *  1. eclass.sch.ac.kr/mypage → SSO OAuth 리다이렉트 체인 → SSO 로그인 페이지 도착
 *  2. SSO 로그인 페이지에서 RSA 키 + ssoChallenge + hidden 필드 파싱
 *  3. JSON 전체를 RSA PKCS1v15 암호화 → POST sso.sch.ac.kr/oa/au/auth/verify
 *  4. medlms.sch.ac.kr 접속 → SSO 자동 인증 → xn_api_token 쿠키 획득
 *  5. /learningx/dashboard HTML에서 data-user_id 추출
 */
import { load } from 'cheerio'
import { CookieJar, fetchWithCookies } from '../cookie-jar'
import { buildEncryptedPw } from './rsa'

const ECLASS_BASE = 'https://eclass.sch.ac.kr'
const SSO_BASE = 'https://sso.sch.ac.kr'
const SSO_VERIFY_URL = `${SSO_BASE}/oa/au/auth/verify`
const MEDLMS_BASE = 'https://medlms.sch.ac.kr'

interface LoginPageData {
  modulus: string
  exponent: string
  ssoChallenge: string
  login_endpoint: string
  retUrl: string
}

function parseLoginPage(html: string): LoginPageData {
  const rsaMatch = html.match(/rsa\.setPublic\(\s*"([0-9a-fA-F]+)"\s*,\s*"([0-9a-fA-F]+)"\s*\)/)
  if (!rsaMatch) throw new Error('RSA 공개키를 찾을 수 없습니다')

  const challengeMatch = html.match(/'ssoChallenge'\s*:\s*'([^']+)'/)

  const $ = load(html)
  const hidden: Record<string, string> = {}
  $('form input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name')
    const value = $(el).attr('value') ?? ''
    if (name) hidden[name] = value
  })

  return {
    modulus: rsaMatch[1],
    exponent: rsaMatch[2],
    ssoChallenge: challengeMatch?.[1] ?? '',
    login_endpoint: hidden['login_endpoint'] ?? 'oauth',
    retUrl: hidden['retUrl'] ?? '',
  }
}

export interface LoginResult {
  success: boolean
  token?: string
  userId?: string
  cookieHeader?: string
  error?: string
  errorType?: 'credentials' | 'server'
}

export async function login(studentId: string, password: string): Promise<LoginResult> {
  const jar = new CookieJar()

  // 1. eclass mypage → SSO 리다이렉트 체인을 따라감
  const { body: loginHtml, finalUrl } = await fetchWithCookies(
    `${ECLASS_BASE}/mypage`,
    { jar, method: 'GET' },
  )

  if (!finalUrl.includes('sso.sch.ac.kr')) {
    return { success: false, error: 'SSO 서버로 연결되지 않았습니다. 학교 서버 상태를 확인해주세요.', errorType: 'server' }
  }

  // 2. RSA 키 + 폼 데이터 파싱
  let pageData: LoginPageData
  try {
    pageData = parseLoginPage(loginHtml)
  } catch (e) {
    return { success: false, error: '로그인 페이지 구조를 읽을 수 없습니다. 학교 서버가 변경되었을 수 있습니다.', errorType: 'server' }
  }

  // 3. JSON 전체를 RSA PKCS1v15 암호화
  const encryptedPw = buildEncryptedPw(
    studentId,
    password,
    pageData.ssoChallenge,
    pageData.modulus,
    pageData.exponent,
  )

  // 4. SSO verify POST
  const formBody = new URLSearchParams({
    login_endpoint: pageData.login_endpoint,
    retUrl: pageData.retUrl,
    id_type: 'H',
    id: studentId,
    pw: encryptedPw,
    passw: '',
  }).toString()

  await fetchWithCookies(SSO_VERIFY_URL, {
    jar,
    method: 'POST',
    body: formBody,
    extraHeaders: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: SSO_BASE,
      Referer: finalUrl,
    },
  })

  // 5. medlms 접속 → xn_api_token 획득
  await fetchWithCookies(MEDLMS_BASE, {
    jar,
    method: 'GET',
    extraHeaders: { Referer: `${ECLASS_BASE}/` },
  })

  const token = jar.get('xn_api_token')
  if (!token) {
    return { success: false, error: '학번 또는 비밀번호가 올바르지 않습니다.', errorType: 'credentials' }
  }

  // 6. medlms 대시보드에서 data-user_id 추출
  const { body: dashHtml } = await fetchWithCookies(
    `${MEDLMS_BASE}/learningx/dashboard`,
    { jar, method: 'GET' },
  )

  const $ = load(dashHtml)
  const userId = $('#root').attr('data-user_id') ?? ''

  return { success: true, token, userId, cookieHeader: jar.header() }
}
