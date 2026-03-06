const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

export class CookieJar {
  private store = new Map<string, string>()

  update(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const [nameValue] = header.split(';')
      if (!nameValue) continue
      const eqIdx = nameValue.indexOf('=')
      if (eqIdx === -1) continue
      const name = nameValue.slice(0, eqIdx).trim()
      const value = nameValue.slice(eqIdx + 1).trim()
      if (name) this.store.set(name, value)
    }
  }

  header(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  get(name: string): string | undefined {
    return this.store.get(name)
  }

  keys(): Set<string> {
    return new Set(this.store.keys())
  }

  // beforeKeys 이후에 새로 추가된 쿠키만 반환 (특정 도메인 접근 후 diff 추출용)
  newCookiesSince(beforeKeys: Set<string>): string {
    return Array.from(this.store.entries())
      .filter(([k]) => !beforeKeys.has(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
}

export interface FetchOptions {
  jar: CookieJar
  method?: string
  body?: string
  extraHeaders?: Record<string, string>
}

export interface FetchResult {
  status: number
  body: string
  finalUrl: string
}

/**
 * requests.Session처럼 쿠키를 추적하면서 리다이렉트를 수동으로 처리한다.
 */
export async function fetchWithCookies(
  url: string,
  options: FetchOptions,
  maxRedirects = 15,
): Promise<FetchResult> {
  const { jar, extraHeaders = {} } = options
  let currentUrl = url
  let method = (options.method ?? 'GET').toUpperCase()
  let body: string | undefined = options.body

  for (let i = 0; i < maxRedirects; i++) {
    const resp = await fetch(currentUrl, {
      method,
      body: method === 'GET' ? undefined : body,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        Cookie: jar.header(),
        ...extraHeaders,
      },
    })

    // Node.js 18+ getSetCookie() API
    const setCookies: string[] =
      typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : []
    jar.update(setCookies)

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location')
      if (!location) break
      currentUrl = new URL(location, currentUrl).href
      // 301/302/303은 POST → GET으로 변환
      if ([301, 302, 303].includes(resp.status)) {
        method = 'GET'
        body = undefined
      }
      continue
    }

    const text = await resp.text()
    return { status: resp.status, body: text, finalUrl: currentUrl }
  }

  throw new Error('Too many redirects')
}
