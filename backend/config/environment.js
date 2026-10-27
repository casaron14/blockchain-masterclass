// Every backend entry point imports this module before reading process.env.
// Variables already set by the platform or shell take precedence over local
// files. .env.local is loaded first so a developer can override the shared
// .env without editing the file that documents the deployment defaults.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const backendRootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRootDirectory = resolve(backendRootDirectory, '..');

dotenv.config({
  path: resolve(repositoryRootDirectory, '.env.local'),
  quiet: true,
});
dotenv.config({
  path: resolve(repositoryRootDirectory, '.env'),
  quiet: true,
});
