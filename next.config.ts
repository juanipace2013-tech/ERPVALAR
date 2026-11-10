import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['fs', 'path', 'unpdf'],
  // No anunciar el framework en cada respuesta.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.anthropic.com https://dolarapi.com https://crm.val-ar.com.ar",
              "frame-src 'self' blob:",
              // El ERP no se puede embeber en páginas de otros sitios (clickjacking).
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          // Solo HTTPS durante un año. El navegador ignora este encabezado
          // sobre HTTP, así que no afecta a localhost.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
