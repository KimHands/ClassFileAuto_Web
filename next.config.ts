import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // node-forge uses Node.js APIs not available in Edge Runtime
  serverExternalPackages: ['node-forge'],
}

export default nextConfig
