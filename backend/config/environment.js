// One place loads the environment for the backend. Every entry point (server,
// tests, CLI scripts) imports this module before reading process.env, so the
// same .env / .env.local precedence applies everywhere and no module has to
// repeat the dotenv setup.
//
// Precedence, highest first:
//   1. variables already in the environment (the platform: Vercel, Docker, CI)
//   2. .env.local (developer overrides)
//   3. .env (shared defaults)
// The platform wins so a deployment variable can never be silently replaced by
// a file left in the repository.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const backendRootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const environmentVariablesProvidedByPlatform = { ...process.env };

dotenv.config({ path: resolve(backendRootDirectory, '.env'), quiet: true });
dotenv.config({
  path: resolve(backendRootDirectory, '.env.local'),
  override: true,
  quiet: true,
});

// Restore anything the platform set, then anything .env.local overwrote that
// the platform had already defined.
for (const [variableName, variableValue] of Object.entries(
  environmentVariablesProvidedByPlatform
)) {
  if (variableValue !== undefined) {
    process.env[variableName] = variableValue;
  }
}
