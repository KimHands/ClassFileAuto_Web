/**
 * Python crawler.py의 EclassCrawler를 TypeScript로 포팅.
 *
 * LearningX REST API:
 *   GET /learningx/api/v1/users/{user_id}/terms
 *   GET /learningx/api/v1/learn_activities/courses?term_ids[]=...
 *   GET /learningx/api/v1/courses/{id}/items
 *   GET /learningx/api/v1/courses/{id}/allcomponents_db   (fallback)
 *   GET /learningx/api/v1/courses/{id}/resources
 *   GET /learningx/api/v1/learningx_board/courses/{id}/posts
 *
 * commons.sch.ac.kr:
 *   GET /viewer/ssplayer/uniplayer_support/content.php?content_id=...  → XML 파싱
 *
 * ⚠️ 목록 수집 단계에서는 commons content.php를 호출하지 않는다.
 *    commons 호출은 건당 5~10초로 느려, 목록에서 풀면 Vercel 함수 타임아웃(504)을 유발한다.
 *    commons 파일은 content.php URL만 담아두고, 실제 다운로드 URL은 /api/download에서 해석한다.
 */
import { load } from 'cheerio'

const MEDLMS_BASE = 'https://medlms.sch.ac.kr'
const LX_API = `${MEDLMS_BASE}/learningx/api/v1`
const COMMONS_BASE = 'https://commons.sch.ac.kr'

export interface Course {
  id: string
  name: string
  semester: string
}

export interface Attachment {
  file_id: string
  filename: string
  url: string
  uploaded_at: string
  // proxy: 서버(/api/download)가 받아 전달 가능
  // browser: Canvas 직링크(verifier 없음) → medlms 세션 필요, 브라우저 새 탭으로 열어야 함
  via?: 'proxy' | 'browser'
}

// 다운로드 경로 판별.
// - commons content.php: 다운로드 시점에 verifier URL을 해석하므로 proxy 가능
// - medlms /files/.../download: verifier가 있으면 proxy 가능, 없으면 Canvas 세션(JS)이 필요해 browser
function downloadVia(url: string): 'proxy' | 'browser' {
  if (url.includes('/uniplayer_support/content.php')) return 'proxy'
  if (url.includes('/files/') && url.includes('/download')) {
    return url.includes('verifier=') ? 'proxy' : 'browser'
  }
  return 'proxy'
}

function lxHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Referer: `${MEDLMS_BASE}/learningx/dashboard`,
    'X-Requested-With': 'XMLHttpRequest',
  }
}

// 상대경로(/...)는 medlms 절대경로로 변환. download 프록시는 절대 URL만 허용한다.
function toAbsolute(href: string): string {
  return href.startsWith('/') ? MEDLMS_BASE + href : href
}

// commons 파일은 content.php URL만 만들어 둔다(네트워크 호출 없음).
// 실제 다운로드 URL 해석은 다운로드 시점(/api/download)으로 미룬다.
function commonsContentUrl(contentId: string): string {
  return `${COMMONS_BASE}/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}`
}

// commons 파일명: content_type을 확장자로 보정
function withContentTypeExt(filename: string, contentType: string): string {
  if (filename && contentType && !filename.toLowerCase().endsWith(`.${contentType}`)) {
    return `${filename}.${contentType}`
  }
  return filename
}

// ── 강의 목록 ──────────────────────────────────────────────────

export async function fetchCourses(token: string, userId: string): Promise<Course[]> {
  const termsResp = await fetch(`${LX_API}/users/${userId}/terms`, {
    headers: lxHeaders(token),
  })
  if (!termsResp.ok) throw new Error(`학기 목록 조회 실패 (${termsResp.status})`)

  const termsData = await termsResp.json()
  const terms: Record<string, { name: string; default: boolean }> = {}
  for (const term of termsData.enrollment_terms ?? []) {
    terms[String(term.id)] = { name: term.name, default: term.default ?? false }
  }

  const allIds = Object.keys(terms)
  const activeIds = allIds.filter((id) => terms[id].default)
  const termIds = activeIds.length > 0 ? activeIds : allIds

  const params = termIds.map((id) => `term_ids[]=${id}`).join('&')
  const coursesResp = await fetch(`${LX_API}/learn_activities/courses?${params}`, {
    headers: lxHeaders(token),
  })
  if (!coursesResp.ok) throw new Error(`강의 목록 조회 실패 (${coursesResp.status})`)

  const coursesData = await coursesResp.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return coursesData
    .filter((c: any) => c.enrolled_status === 'active')
    .map((c: any) => ({
      id: String(c.id),
      name: c.name,
      semester: terms[String(c.term_id)]?.name ?? '',
    }))
}

// ── 첨부파일 목록 ───────────────────────────────────────────────

export async function fetchAttachments(
  token: string,
  studentId: string,
  userId: string,
  courseId: string,
): Promise<Attachment[]> {
  const [content, board, assignment] = await Promise.all([
    getContentAttachments(token, studentId, userId, courseId),
    getBoardFiles(token, courseId),
    getAssignmentFiles(token, courseId),
  ])

  // 중복 제거 + 다운로드 경로 분류
  const seen = new Set<string>()
  const unique: Attachment[] = []
  for (const att of [...content, ...board, ...assignment]) {
    if (!seen.has(att.file_id)) {
      seen.add(att.file_id)
      unique.push({ ...att, via: downloadVia(att.url) })
    }
  }
  return unique
}

// ── 강의콘텐츠 ─────────────────────────────────────────────────

async function getContentAttachments(
  token: string,
  studentId: string,
  userId: string,
  courseId: string,
): Promise<Attachment[]> {
  const items = await fetchLxItems(token, courseId)
  const attachments: Attachment[] = []

  if (items.length > 0) {
    for (const section of items) {
      for (const subsection of section.subsections ?? []) {
        for (const unit of subsection.units ?? []) {
          for (const comp of unit.components ?? []) {
            extractComponentAttachments(comp, attachments)
          }
        }
      }
    }
  } else {
    // fallback: allcomponents_db
    const components = await fetchAllComponentsDb(token, studentId, userId, courseId)
    for (const comp of components) {
      extractComponentAttachments(comp, attachments)
    }
  }

  return attachments
}

function extractComponentAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  comp: any,
  attachments: Attachment[],
) {
  const compType: string = comp.type ?? ''
  const unlockAt: string = comp.unlock_at ?? ''

  if (compType === 'commons') {
    const commonsInfo = comp.commons_content ?? {}
    const contentId: string = commonsInfo.content_id ?? ''
    if (!contentId || contentId === 'not_open') return

    const filename = withContentTypeExt(
      commonsInfo.file_name ?? comp.title ?? '',
      commonsInfo.content_type ?? '',
    )
    if (filename) {
      attachments.push({
        file_id: contentId,
        filename,
        url: commonsContentUrl(contentId),
        uploaded_at: unlockAt,
      })
    }
  } else if (compType === 'text') {
    const description: string = comp.description ?? ''
    if (!description) return

    const $ = load(description)
    $('a.description_file_attachment').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      const filename =
        $(el).find('span.description_file_name').text().trim() || $(el).text().trim()
      if (href && filename) {
        const absHref = toAbsolute(href)
        const m = absHref.match(/\/files\/(\d+)\/download/)
        const fileId = m?.[1] ?? href
        attachments.push({
          file_id: `text_${fileId}`,
          filename,
          url: absHref,
          uploaded_at: unlockAt,
        })
      }
    })
  }
}

// ── 강의자료실 ─────────────────────────────────────────────────

async function getBoardFiles(token: string, courseId: string): Promise<Attachment[]> {
  const resp = await fetch(`${LX_API}/courses/${courseId}/resources`, {
    headers: lxHeaders(token),
  })
  if (!resp.ok) return []

  const attachments: Attachment[] = []
  const resources = await resp.json()

  for (const resource of resources) {
    // 방식 1: commons_content → content.php URL만 담아둔다 (다운로드 시점 해석)
    const commonsInfo = resource.commons_content ?? {}
    const contentId: string = commonsInfo.content_id ?? ''
    if (contentId && contentId !== 'not_open') {
      const filename = withContentTypeExt(
        commonsInfo.file_name ?? '',
        commonsInfo.content_type ?? '',
      )
      if (filename) {
        attachments.push({
          file_id: `res_commons_${contentId}`,
          filename,
          url: commonsContentUrl(contentId),
          uploaded_at: '',
        })
      }
    }

    // 방식 2: description HTML 파일 링크
    const description: string = resource.description ?? ''
    if (description) {
      const $ = load(description)
      $('a.description_file_attachment').each((_, el) => {
        const href = $(el).attr('href') ?? ''
        const filename =
          $(el).find('span.description_file_name').text().trim() || $(el).text().trim()
        if (href && filename) {
          const absHref = toAbsolute(href)
          const m = absHref.match(/\/files\/(\d+)\/download/)
          const fileId = m?.[1] ?? href
          attachments.push({
            file_id: `res_file_${fileId}`,
            filename,
            url: absHref,
            uploaded_at: '',
          })
        }
      })
    }
  }

  return attachments
}

// ── 과제 및 평가 ───────────────────────────────────────────────

async function getAssignmentFiles(token: string, courseId: string): Promise<Attachment[]> {
  const attachments: Attachment[] = []
  let page = 1

  while (true) {
    const resp = await fetch(
      `${MEDLMS_BASE}/learningx/api/v1/learningx_board/courses/${courseId}/posts?page=${page}&page_size=20`,
      { headers: lxHeaders(token) },
    )
    if (!resp.ok) break

    const data = await resp.json()
    const posts = data.posts ?? []
    if (posts.length === 0) break

    for (const post of posts) {
      const postId = String(post.id ?? '')
      const createdAt: string = post.created_at ?? ''

      // body/description에서 파일 링크 추출
      const body: string = post.body ?? post.description ?? ''
      if (body) {
        const $ = load(body)
        $('a.description_file_attachment').each((_, el) => {
          const href = $(el).attr('href') ?? ''
          const filename =
            $(el).find('span.description_file_name').text().trim() || $(el).text().trim()
          if (href && filename) {
            const absHref = toAbsolute(href)
            const m = absHref.match(/\/files\/(\d+)\/download/)
            const fileId = m?.[1] ?? href
            attachments.push({
              file_id: `board_post_${postId}_${fileId}`,
              filename,
              url: absHref,
              uploaded_at: createdAt,
            })
          }
        })
      }

      // attachments 필드
      for (const att of post.attachments ?? []) {
        const fileId = String(att.id ?? '')
        const filename: string = att.display_name ?? att.filename ?? ''
        const downloadUrl: string = att.url ?? ''
        if (fileId && filename && downloadUrl) {
          attachments.push({
            file_id: `board_att_${postId}_${fileId}`,
            filename,
            url: toAbsolute(downloadUrl),
            uploaded_at: createdAt,
          })
        }
      }
    }

    const pagination = data.pagination ?? {}
    if (page >= (pagination.last_page ?? 1)) break
    page++
  }

  return attachments
}

// ── LearningX API ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchLxItems(token: string, courseId: string): Promise<any[]> {
  const resp = await fetch(`${LX_API}/courses/${courseId}/items`, {
    headers: lxHeaders(token),
  })
  if (!resp.ok) return []
  return resp.json()
}

async function fetchAllComponentsDb(
  token: string,
  studentId: string,
  userId: string,
  courseId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const params = new URLSearchParams({
    user_id: userId,
    user_login: `H${studentId}`,
    role: 'StudentEnrollment',
  })
  const resp = await fetch(`${LX_API}/courses/${courseId}/allcomponents_db?${params}`, {
    headers: lxHeaders(token),
  })
  if (!resp.ok) return []
  return resp.json()
}
