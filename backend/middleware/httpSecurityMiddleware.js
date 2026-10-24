import cors from 'cors';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://masterclass.dienacademy.com',
  'https://blockchain-masterclass.vercel.app/'
];

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

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

export function buildCorsPolicy() {
  const allowedOrigins = readConfiguredCorsOriginsFromEnvironment() ?? DEFAULT_ALLOWED_ORIGINS;

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