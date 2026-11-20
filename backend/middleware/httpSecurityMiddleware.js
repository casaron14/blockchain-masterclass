import cors from 'cors';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://masterclass.dienacademy.com',
  'https://blockchain-masterclass.vercel.app'
];

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Any response that carries an order, payment or attendee record must never be
// stored by a shared cache, a proxy or the browser history cache.
export function preventSensitiveResponseCaching(req, res, next) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  next();
}

export function buildSecurityHeaders(disableHsts = false) {
  return (req, res, next) => {
    const securityHeaders = {
      ...SECURITY_HEADERS,
    };
    if (!disableHsts && req.secure) {
      securityHeaders['Strict-Transport-Security'] = 'max-age=63072000';
    }
    res.set(securityHeaders);
    next();
  };
}

function readConfiguredCorsOriginsFromEnvironment() {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (!configuredOrigins) {
    return null;
  }
  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function readVercelDeploymentOriginsFromEnvironment() {
  return ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL']
    .map((variableName) => process.env[variableName]?.trim())
    .filter(Boolean)
    .map((deploymentHost) => `https://${deploymentHost}`);
}

export function buildCorsPolicy() {
  const configuredOrigins =
    readConfiguredCorsOriginsFromEnvironment() ?? DEFAULT_ALLOWED_ORIGINS;
  const allowedOrigins = [
    ...new Set([
      ...configuredOrigins,
      ...readVercelDeploymentOriginsFromEnvironment(),
    ]),
  ];

  return cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
    },
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  });
}