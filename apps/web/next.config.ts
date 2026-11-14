import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? {output: "export", trailingSlash: true, basePath: process.env.NEXT_PUBLIC_BASE_PATH} : {}),
};

export default nextConfig;
