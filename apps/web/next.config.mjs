import { dirname } from "path"
import { fileURLToPath } from "url"

// Pin the workspace root to this directory — otherwise Next walks up and can pick a
// stray lockfile outside the project (e.g. one in the home dir) as the root.
const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
