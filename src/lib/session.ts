import { getIronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET 환경변수가 없거나 너무 짧습니다 (최소 32자)')
}

export interface SessionData {
  isLoggedIn: boolean
  token: string
  userId: string
  studentId: string
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: 'eclass_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8시간
  },
}

export async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}
