// Every backend entry point imports this module before reading process.env.
// Variables already set by the platform or shell take precedence over the
// shared repository-root .env file.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const backendRootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRootDirectory = resolve(backendRootDirectory, '..');

dotenv.config({ path: resolve(repositoryRootDirectory, '.env'), quiet: true });
