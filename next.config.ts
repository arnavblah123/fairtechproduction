import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
