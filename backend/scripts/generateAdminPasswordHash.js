import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

// Vercel stores the deployed admin credentials as environment variables. The
// password can be a bcrypt hash so the plain value never sits in the project
// settings. Run this script to produce the hash, then paste the printed line
// into Vercel -> Settings -> Environment Variables.
const BCRYPT_SALT_ROUNDS = 12;
const GENERATED_PASSWORD_BYTE_LENGTH = 18;

async function generateAdminPasswordHashForEnvironment() {
  const providedPassword = process.argv[2]?.trim();
  const adminPassword =
    providedPassword ||
    crypto.randomBytes(GENERATED_PASSWORD_BYTE_LENGTH).toString('base64url');

  const adminPasswordHash = await bcrypt.hash(
    adminPassword,
    BCRYPT_SALT_ROUNDS
  );

  if (!providedPassword) {
    console.log('Generated admin password (store this in a password manager):');
    console.log(`  ${adminPassword}`);
    console.log('');
  }

  console.log('Add this to Vercel (single quotes keep the $ characters intact):');
  console.log(`ADMIN_PASSWORD_HASH='${adminPasswordHash}'`);
}

generateAdminPasswordHashForEnvironment().catch((error) => {
  console.error('Could not generate the admin password hash:', error.message);
  process.exitCode = 1;
});
