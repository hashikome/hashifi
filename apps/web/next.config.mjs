const apiOrigin =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The repository keeps its own AGENTS.md; `next dev` must not write one here.
  agentRules: false,
  images: {
    unoptimized: true,
  },
  // Before login the walled garden admits one host, this one (ADR-0008), so a guest's browser
  // reaches the API through it.
  // The router's pages, on the router's origin, load the font from here.
  headers: async () => [
    { source: "/fonts/:file", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
  ],
  rewrites: async () => [
    { source: "/api/guest/:path*", destination: `${apiOrigin}/api/guest/:path*` },
  ],
};

export default nextConfig;
