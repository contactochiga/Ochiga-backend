import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
// Synthetic fixture generated with bcrypt 5; never a user credential.
const legacy = '$2b$04$JuyZspcKINdSCfAKZSJZDexAELzjOhap/lS0nJONJTjlIDmPhVD4q';
assert(await bcrypt.compare('synthetic-wave9-compatibility', legacy));
assert(!(await bcrypt.compare('wrong', legacy)));
const current = await bcrypt.hash('synthetic-🔒', 4);
assert(bcrypt.compareSync('synthetic-🔒', current));
console.log('PASS bcrypt 5 persisted-hash compatibility, invalid password and Unicode async/sync');
