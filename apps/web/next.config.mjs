/** @type {import('next').NextConfig} */
const nextConfig = {
  // The repository keeps its own AGENTS.md; `next dev` must not write one here.
  agentRules: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
