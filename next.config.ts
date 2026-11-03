import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Inter for Marver frame screenshots (lib/marver/shot) is read from node_modules at runtime, so ship it with every function.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-600-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-700-normal.woff",
    ],
  },
  // Private checkouts cloned into .local-repos for local development (docs/self-hosting.md) never go
  // into a function's trace, so a local or prebuilt build can't ship them. "*" matches every route (and next-server).
  outputFileTracingExcludes: {
    "*": [".local-repos/**"],
  },
  // "Sources" became "Add feedback"; Slack messages and old links still point at /sources.
  async redirects() {
    return [
      { source: "/sources", destination: "/feedback", permanent: true },
      { source: "/sources/:id", destination: "/feedback/:id", permanent: true },
      // "Projects" became "Work".
      { source: "/:org/:app/projects", destination: "/:org/:app/work", permanent: true },
    ];
  },
};

export default nextConfig;
