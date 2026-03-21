/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev }) {
    if (dev) {
      // Stable chunk IDs across dev rebuilds — prevents "Cannot find module './XXXX.js'" errors
      // that occur when webpack re-splits chunks after large code changes.
      config.optimization.moduleIds = 'deterministic';
      config.optimization.chunkIds  = 'deterministic';
    }
    return config;
  },
};

export default nextConfig;
