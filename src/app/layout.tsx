import type { Metadata } from 'next'
import './globals.css'

const DESCRIPTION =
  '강의 자료를 브라우저에서 한 번에 — 강의콘텐츠·강의자료실·과제 파일을 모아 개별/일괄 다운로드'

export const metadata: Metadata = {
  metadataBase: new URL('https://class-file-auto-web.vercel.app'),
  title: 'SCH Eclass 파일 다운로더',
  description: DESCRIPTION,
  openGraph: {
    title: 'SCH Eclass 다운로더',
    description: DESCRIPTION,
    url: 'https://class-file-auto-web.vercel.app',
    siteName: 'SCH Eclass 다운로더',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SCH Eclass 다운로더',
    description: DESCRIPTION,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col antialiased">
        <main className="flex-1">{children}</main>
        <footer className="py-4 text-center text-xs text-slate-600">
          <p>Made by SCH CSE 23학번 김종건</p>
          <p className="mt-0.5">© {new Date().getFullYear()} KIM JONG GUN. All rights reserved.</p>
        </footer>
      </body>
    </html>
  )
}
