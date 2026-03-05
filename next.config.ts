import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // node-forge uses Node.js APIs not available in Edge Runtime
  serverExternalPackages: ['node-forge'],
  // workspace root 경고 해결
  outputFileTracingRoot: path.join(__dirname, '../'),
}

export default nextConfig
