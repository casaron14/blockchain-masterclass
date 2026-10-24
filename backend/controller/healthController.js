import { randomUUID } from 'node:crypto';

import pool from '../config/db.js';
import { logError } from '../utils/applicationLogger.js';

export async function respondToDatabaseHealthCheck(request, response) {
  const requestId = request.requestId || randomUUID();

  try {
    await pool.query('SELECT 1');
    return response.json({
      status: 'ok',
      database: 'connected',
      requestId,
    });
  } catch (error) {
    logError('health_check_database_probe_failed', {
      requestId,
      errorMessage: error.message,
    });
    return response.status(503).json({
      status: 'degraded',
      database: 'unavailable',
      requestId,
    });
  }
}
