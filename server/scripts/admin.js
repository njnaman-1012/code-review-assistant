// Administrator tool. It is run on the server by the administrator; there is
// no API or page for these actions, so a normal user can never reach them.
//
//   npm run admin -w server -- users                         registered users and their AI usage
//   npm run admin -w server -- tokens <email> [tokens]       new allowance, usage back to 0
//   npm run admin -w server -- disable <email>               the account can no longer log in
//   npm run admin -w server -- enable <email>
//   npm run admin -w server -- events [count]                newest security events
//
// It uses the same database as the application (server/.env; for the hosted
// database set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN).
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const { config } = await import('../config/config.js');
const { createDatabase } = await import('../database/db.js');
const { createUserModel } = await import('../models/userModel.js');
const { createUsageModel } = await import('../models/usageModel.js');
const { createSecurityEventModel } = await import('../models/securityEventModel.js');

const [command, ...args] = process.argv.slice(2);
const db = await createDatabase(config.database);

function finish(message, failed = false) {
  if (message) (failed ? console.error : console.log)(message);
  db.close();
  process.exit(failed ? 1 : 0);
}

async function findUser(email) {
  const user = await createUserModel(db).findByEmailWithHash((email ?? '').trim().toLowerCase());
  if (!user) finish(`No user with the e-mail address ${email}.`, true);
  return user;
}

switch (command) {
  case 'users': {
    const { rows } = await db.execute(`
      SELECT users.id, users.email, users.email_verified AS verified, users.disabled, users.created_at,
             user_ai_usage.tokens_allocated AS allocated, user_ai_usage.tokens_used AS used, user_ai_usage.tokens_remaining AS remaining,
             (SELECT COUNT(*) FROM reviews WHERE reviews.user_id = users.id) AS reviews
      FROM users LEFT JOIN user_ai_usage ON user_ai_usage.user_id = users.id
      ORDER BY users.id`);
    console.table(rows.map((row) => ({ ...row })));
    finish();
    break;
  }
  case 'tokens': {
    const user = await findUser(args[0]);
    const tokens = args[1] === undefined ? config.usage.defaultUserTokens : Number(args[1]);
    if (!Number.isInteger(tokens) || tokens < 0) finish('The number of tokens must be a whole number.', true);
    const changed = await createUsageModel(db).resetAllowance(user.id, tokens);
    finish(changed
      ? `${user.email} now has ${tokens.toLocaleString('en-US')} AI tokens (0 used).`
      : `${user.email} has not verified the e-mail address yet, so there is no allowance to change.`, !changed);
    break;
  }
  case 'disable':
  case 'enable': {
    const user = await findUser(args[0]);
    await createUserModel(db).setDisabled(user.id, command === 'disable');
    await createSecurityEventModel(db).record({ userId: user.id, event: `account_${command}d_by_administrator` });
    finish(`${user.email} is now ${command}d.`);
    break;
  }
  case 'events': {
    console.table(await createSecurityEventModel(db).findRecent(Number(args[0]) || 50));
    finish();
    break;
  }
  default:
    finish('Usage: node scripts/admin.js users | tokens <email> [tokens] | disable <email> | enable <email> | events [count]', true);
}
