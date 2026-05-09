import type { NextConfig } from "next";

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
