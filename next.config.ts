import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The labour calling app is served as static files from public/labour;
    // this makes the friendly /labour URL land on its entry point.
    return [
      { source: "/labour", destination: "/labour/index.html", permanent: false },
      { source: "/labour/", destination: "/labour/index.html", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      // Drawings/BOM uploads go through server actions; allow a few files
      // of up to ATTACHMENT_MAX_BYTES each per request.
      bodySizeLimit: "60mb",
    },
    // The middleware body buffer must match, or uploads over 10MB are cut
    // off before per-file size validation can produce a friendly error.
    middlewareClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
