import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  images: {
    // Uploads live in public/uploads, and since Next 14.2 every local path is
    // blocked by default, so the optimiser has to be told which folder is ours.
    // `search: ""` pins it to exactly this prefix - leaving `search` out would
    // allow any query string on those files.
    localPatterns: [{ pathname: "/uploads/**", search: "" }],
  },
  experimental: {
    cpus: 1,
    workerThreads: true,
  },
};

export default nextConfig;
