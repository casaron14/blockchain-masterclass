import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const frontendRootDirectory = path.dirname(fileURLToPath(import.meta.url));
// The Express API and the shared event configuration live one level above the
// frontend. The tracing root must cover both so the API functions can include
// backend/ and shared/ files in their deployed bundles.
const repositoryRootDirectory = path.resolve(frontendRootDirectory, '..');

dotenv.config({
  path: path.resolve(repositoryRootDirectory, '.env'),
  quiet: true,
});

// Native and dependency-heavy modules stay outside the webpack bundle. Next
// traces them from frontend/node_modules into the function instead, which keeps
// the build fast and lets modules that load data files at runtime (pdfkit
// fonts) find those files on disk.
const SERVER_DEPENDENCIES_LOADED_AT_RUNTIME = [
  'bcrypt',
  'cors',
  'dotenv',
  'ethers',
  'express',
  'express-rate-limit',
  'joi',
  'jsonwebtoken',
  'multer',
  'nodemailer',
  'pdfkit',
  'pg',
  'qrcode',
  '@supabase/supabase-js',
];

// Some backend modules may import a package subpath instead of the package
// entry point. A request for a subpath must be externalised for the same
// reason as the bare package name, otherwise webpack tries to resolve a path
// that only exists once node_modules is installed inside the deployed function.
function isServerDependencyLoadedAtRuntime(request) {
  return SERVER_DEPENDENCIES_LOADED_AT_RUNTIME.some(
    (packageName) => request === packageName || request.startsWith(`${packageName}/`),
  );
}

const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  outputFileTracingRoot: repositoryRootDirectory,
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/pdfkit/js/data/**/*',
      './node_modules/bcrypt/**/*',
    ],
  },
  serverExternalPackages: SERVER_DEPENDENCIES_LOADED_AT_RUNTIME,

  // Pages Router API routes are bundled by webpack even with
  // `serverExternalPackages`; native modules (bcrypt) and packages that locate
  // their own data files by __dirname (pdfkit) must be required from
  // node_modules at runtime instead. This keeps the Express application in
  // ../backend bundled while its dependencies stay real files.
  webpack(configuration, { isServer }) {
    if (isServer) {
      configuration.externals = [
        ...(configuration.externals ?? []),
        ({ request }, resolveExternally) => {
          if (isServerDependencyLoadedAtRuntime(request)) {
            return resolveExternally(null, `commonjs ${request}`);
          }
          return resolveExternally();
        },
      ];
    }
    return configuration;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
