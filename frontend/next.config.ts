import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export', // Fully static export to be served by Flask
  trailingSlash: true,
  images: { unoptimized: true }
};

export default nextConfig;
