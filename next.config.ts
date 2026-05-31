import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // node-forge uses Node.js APIs not available in Edge Runtime
  serverExternalPackages: ['node-forge'],
  // 상위 폴더의 다른 lockfile로 워크스페이스 루트가 잘못 잡히지 않도록 고정한다.
  outputFileTracingRoot: path.join(__dirname),
}

export default nextConfig
