const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
const privateArea = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: security },
      { source: "/studio/:path*", headers: privateArea },
      { source: "/studio", headers: privateArea },
      { source: "/dashboard/:path*", headers: privateArea },
      { source: "/dashboard", headers: privateArea },
      { source: "/api/:path*", headers: privateArea },
    ];
  },
};

export default nextConfig;
