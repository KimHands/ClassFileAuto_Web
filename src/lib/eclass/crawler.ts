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
}

function lxHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Referer: `${MEDLMS_BASE}/learningx/dashboard`,
    'X-Requested-With': 'XMLHttpRequest',
  }
}

async function delay(ms = 700) {
  return new Promise((r) => setTimeout(r, ms))
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

  // 중복 제거
  const seen = new Set<string>()
  const unique: Attachment[] = []
  for (const att of [...content, ...board, ...assignment]) {
    if (!seen.has(att.file_id)) {
      seen.add(att.file_id)
      unique.push(att)
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
            await extractComponentAttachments(token, comp, attachments)
            await delay()
          }
        }
      }
    }
  } else {
    // fallback: allcomponents_db
    const components = await fetchAllComponentsDb(token, studentId, userId, courseId)
    for (const comp of components) {
      await extractComponentAttachments(token, comp, attachments)
      await delay()
    }
  }

  return attachments
}

async function extractComponentAttachments(
  token: string,
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

    let filename: string = commonsInfo.file_name ?? comp.title ?? ''
    const contentType: string = commonsInfo.content_type ?? ''
    if (filename && contentType && !filename.toLowerCase().endsWith(`.${contentType}`)) {
      filename = `${filename}.${contentType}`
    }

    const downloadUrl = await getCommonsDownloadUrl(token, contentId)
    if (downloadUrl && filename) {
      attachments.push({ file_id: contentId, filename, url: downloadUrl, uploaded_at: unlockAt })
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
        const absHref = href.startsWith('/') ? MEDLMS_BASE + href : href
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
    // 방식 1: commons_content
    const commonsInfo = resource.commons_content ?? {}
    const contentId: string = commonsInfo.content_id ?? ''
    if (contentId && contentId !== 'not_open') {
      let filename: string = commonsInfo.file_name ?? ''
      const contentType: string = commonsInfo.content_type ?? ''
      if (filename && contentType && !filename.toLowerCase().endsWith(`.${contentType}`)) {
        filename = `${filename}.${contentType}`
      }
      const downloadUrl = await getCommonsDownloadUrl(token, contentId)
      if (downloadUrl && filename) {
        attachments.push({
          file_id: `res_commons_${contentId}`,
          filename,
          url: downloadUrl,
          uploaded_at: '',
        })
      }
      await delay()
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
          const m = href.match(/\/files\/(\d+)\/download/)
          const fileId = m?.[1] ?? href
          attachments.push({
            file_id: `res_file_${fileId}`,
            filename,
            url: href,
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
            const m = href.match(/\/files\/(\d+)\/download/)
            const fileId = m?.[1] ?? href
            attachments.push({
              file_id: `board_post_${postId}_${fileId}`,
              filename,
              url: href,
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
            url: downloadUrl,
            uploaded_at: createdAt,
          })
        }
      }
    }

    const pagination = data.pagination ?? {}
    if (page >= (pagination.last_page ?? 1)) break
    page++
    await delay()
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

// ── commons 다운로드 URL ───────────────────────────────────────

async function getCommonsDownloadUrl(token: string, contentId: string): Promise<string> {
  const resp = await fetch(
    `${COMMONS_BASE}/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}`,
    { headers: { Cookie: `xn_api_token=${token}` } },
  )
  if (!resp.ok) return ''

  const xml = await resp.text()
  const match = xml.match(/<content_download_uri>([^<]+)<\/content_download_uri>/)
  if (match?.[1]) return COMMONS_BASE + match[1]

  return ''
}
