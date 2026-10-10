import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets pages answer 403 with forbidden() when a viewer opens an admin-only page.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
