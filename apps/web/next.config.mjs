/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // "standalone" is only needed for the Docker image (see infra/docker/web.Dockerfile); Vercel ignores it.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Cross-origin isolation lets the in-browser speech model (WASM) use several CPU threads instead of one.
  // "credentialless" keeps loading the model from public CDNs working.
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ] }];
  },
};
export default nextConfig;
