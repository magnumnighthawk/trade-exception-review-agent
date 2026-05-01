import type { NextConfig } from "next";

/**
 * LEARNING: In development, we proxy /review/* and /queue/* requests from
 * Next.js (port 3000) to FastAPI (port 8000). This avoids CORS issues during
 * local development. In production, you'd use a proper reverse proxy (nginx,
 * AWS ALB) or configure CORS on the FastAPI side with your real domain.
 *
 * TRADE-OFF: Rewrites are transparent to the browser — it sees requests to
 * localhost:3000/review/... which are forwarded server-side. This means
 * EventSource connections also go through the proxy, which works fine for
 * SSE as long as the proxy doesn't buffer the response.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/review/:path*",
        destination: "http://localhost:8000/review/:path*",
      },
      {
        source: "/queue/:path*",
        destination: "http://localhost:8000/queue/:path*",
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
