import '../config/environment.js';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createAdminUserInDatabase } from '../controller/authController.js';

import { EVENT_TITLE } from '../services/eventConfigService.js';

const readlineInterface = readline.createInterface({ input, output });

async function promptForRequiredField(promptMessage, isHiddenValue = false) {
  let collectedValue = '';
  while (!collectedValue.trim()) {
    collectedValue = await readlineInterface.question(promptMessage, {
      isHidden: isHiddenValue,
    });
    if (!collectedValue.trim()) {
      console.log('This field is required. Please try again.');
    }
  }
  return collectedValue.trim();
}

async function runAdminUserCreation() {
  try {
    console.log(`Create a new admin user for the ${EVENT_TITLE} admin panel.\n`);

    const name = await promptForRequiredField('Full name: ');
    const username = await promptForRequiredField('Username: ');
    const email = await promptForRequiredField('Email: ');
    const password = await promptForRequiredField('Password (min 8 chars): ', true);
    const passwordConfirmation = await promptForRequiredField('Confirm password: ', true);

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }
    if (password !== passwordConfirmation) {
      throw new Error('Passwords do not match');
    }

    const createdAdminUser = await createAdminUserInDatabase({
      name,
      username,
      email,
      password,
    });

    console.log('\nAdmin user created successfully:');
    console.log(`  - name:     ${createdAdminUser.name}`);
    console.log(`  - username: ${createdAdminUser.username}`);
    console.log(`  - email:    ${createdAdminUser.email}`);
    console.log('\nLog in at /admin with your username and password.');
    console.log('On first login you will be guided to set up Google Authenticator (TOTP).');
  } catch (error) {
    if (error.code === '23505') {
      console.error('Creation failed: a user with that username or email already exists.');
    } else {
      console.error('Creation failed:', error.message);
    }
    process.exitCode = 1;
  } finally {
    readlineInterface.close();
  }
}

await runAdminUserCreation();