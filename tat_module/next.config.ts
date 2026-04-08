import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['mapbox-gl', 'react-map-gl'],
  async rewrites() {
    return [
      {
        source: '/api/navixy/:path*',
        destination: 'https://api.navixy.com/v2/:path*',
      },
    ];
  },
};

export default nextConfig;
