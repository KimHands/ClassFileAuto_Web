// SCH Eclass 다운로더 로고 — 다운로드 화살표가 결합된 'E' 레터마크
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="SCH Eclass 다운로더 로고">
      <rect x="4" y="4" width="92" height="92" rx="24" fill="#2563eb" />
      <g fill="#fff">
        <rect x="34" y="18" width="10" height="44" rx="2" />
        <rect x="34" y="18" width="32" height="10" rx="2" />
        <rect x="34" y="35" width="25" height="10" rx="2" />
        <rect x="34" y="52" width="32" height="10" rx="2" />
      </g>
      <path
        d="M50 69 V83 M43 76 l7 7 l7 -7"
        stroke="#bfdbfe"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
