import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SCH Eclass 파일 다운로더',
  description: '순천향대학교 Eclass 강의 자료 다운로드',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
