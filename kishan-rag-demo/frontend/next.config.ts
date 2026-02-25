import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,   // lint errors won't block the Vercel build
  },
};

export default nextConfig;
