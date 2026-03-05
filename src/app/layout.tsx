import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SCH Eclass 파일 다운로더',
  description: '순천향대학교 Eclass 강의 자료 다운로드',
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
