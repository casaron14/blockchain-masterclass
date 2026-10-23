// Minimal structured logger. Every line is one JSON object so a log collector
// can index it without a parsing rule per message. It deliberately does not
// replace the domain-level console calls that already carry human context;
// request, startup and error paths use it so a production incident is
// searchable by request id and level.
function writeLogLine(level, eventName, details = {}) {
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: eventName,
    ...details,
  });

  if (level === 'error') {
    console.error(logLine);
    return;
  }
  if (level === 'warn') {
    console.warn(logLine);
    return;
  }
  console.log(logLine);
}

export function logInfo(eventName, details) {
  writeLogLine('info', eventName, details);
}

export function logWarning(eventName, details) {
  writeLogLine('warn', eventName, details);
}

export function logError(eventName, details) {
  writeLogLine('error', eventName, details);
}
