// Creates an archivist account. There is no self-service admin registration by
// design: the only way into the panel is a row inserted by someone with shell
// access to the server.
//
//   node scripts/archive/create-admin.mjs --email you@example.com --name "Your Name"
//   node scripts/archive/create-admin.mjs --email c@example.com --name "C" --role owner --reset
//
// The password is read from the terminal without echo, or from ADMIN_PASSWORD
// when the script is driven by a deploy script. It is hashed with scrypt before
// it reaches Postgres, and it is never printed back.

import { createInterface } from 'node:readline';

import { loadConfig } from '../../app/config.js';
import { createDb, createPgExecutor } from '../../app/db.js';
import { hashSecret } from './secret-hash.mjs';

const ROLES = ['owner', 'admin', 'reviewer'];

function parseArgs(argv) {
  const args = { role: 'admin', reset: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };

    if (flag === '--email') args.email = next();
    else if (flag === '--name') args.name = next();
    else if (flag === '--role') args.role = next();
    else if (flag === '--reset') args.reset = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return args;
}

function usage() {
  return [
    'usage: node scripts/archive/create-admin.mjs --email <address> --name <display name> [options]',
    '',
    '  --role <owner|admin|reviewer>   default: admin',
    '  --reset                         reset the password of an existing address',
    '',
    'The password is prompted for without echo, or read from ADMIN_PASSWORD.',
  ].join('\n');
}

function promptPassword(label) {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = true;

    // readline echoes what is typed; while muted, print a placeholder instead so
    // the password never appears on screen or in a terminal recording.
    rl._writeToOutput = (text) => {
      if (muted && !text.includes('\n') && !text.includes('\r')) rl.output.write('*');
      else rl.output.write(text);
    };

    rl.question(label, (answer) => {
      muted = false;
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!args.email || !args.name) {
    console.error(usage());
    return 2;
  }

  const email = args.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('That email address does not look valid.');
    return 2;
  }
  if (!ROLES.includes(args.role)) {
    console.error(`--role must be one of: ${ROLES.join(', ')}`);
    return 2;
  }

  const password = await promptPassword('Password (12+ characters): ');
  process.stdout.write('\n');

  if (!password || password.length < 12) {
    console.error('Refusing a password shorter than 12 characters.');
    return 2;
  }

  const config = loadConfig();
  const db = createDb(createPgExecutor(config.databaseUrl));

  try {
    const existing = await db.one('select id, email from admin_users where email = $1', [email]);

    let admin;
    if (existing && !args.reset) {
      console.error(`${email} already exists. Re-run with --reset to change its password.`);
      return 1;
    }

    if (existing) {
      admin = await db.one(
        `update admin_users
            set password_hash = $2, display_name = $3, role = $4, is_active = true
          where id = $1
          returning id, email, display_name, role`,
        [existing.id, hashSecret(password), args.name.trim(), args.role]
      );
    } else {
      admin = await db.one(
        `insert into admin_users (email, display_name, password_hash, role)
         values ($1, $2, $3, $4)
         returning id, email, display_name, role`,
        [email, args.name.trim(), hashSecret(password), args.role]
      );
    }

    // Bootstrapping is a privileged action, so it is recorded like any other.
    // admin_id is null: this was done from the shell, not from a session.
    await db.query(
      `insert into admin_audit_logs (admin_id, action, entity, entity_id, after_state)
       values (null, $1, 'admin_users', $2, $3::jsonb)`,
      [
        existing ? 'admin.reset_from_cli' : 'admin.create_from_cli',
        String(admin.id),
        JSON.stringify({ email: admin.email, role: admin.role }),
      ]
    );

    console.log(`\nArchivist ${existing ? 'updated' : 'created'}:`);
    console.log(`  ${admin.email} · ${admin.display_name} · ${admin.role}`);
    console.log(`  id ${admin.id}`);
    console.log('\nSign in at /admin/login. The password is not stored anywhere in readable form.');
    return 0;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[create-admin] ${error.message}`);
    process.exit(1);
  });
