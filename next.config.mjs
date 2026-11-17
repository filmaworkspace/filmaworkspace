/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // De momento no hay portada: la raíz lleva directamente al login.
      // Temporal (307) para que los navegadores no lo memoricen.
      { source: "/", destination: "/login", permanent: false },
    ];
  },
};

export default nextConfig;
