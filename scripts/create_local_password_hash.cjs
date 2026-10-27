'use strict';
const {hashPassword} = require('../server/local_auth.cjs');

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  process.stderr.write('Futtasd interaktív terminálban: node scripts/create_local_password_hash.cjs\n');
  process.exit(1);
}
process.stdout.write('Új helyi jelszó (min. 16 karakter, nem jelenik meg): ');
let password = '';
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  for (const char of chunk) {
    if (char === '\u0003') {process.stdout.write('\n');process.exit(130);}
    if (char === '\r' || char === '\n') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      try {process.stdout.write('LOCAL_LOGIN_PASSWORD_HASH=' + hashPassword(password) + '\n');}
      catch (error) {process.stderr.write(error.message + '\n');process.exitCode = 1;}
      password = '';
      return;
    }
    if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
    else if (char >= ' ' && password.length < 1024) password += char;
  }
});
