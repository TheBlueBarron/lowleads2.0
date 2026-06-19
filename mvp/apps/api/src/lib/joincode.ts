import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

// 32-char unambiguous alphabet (no I, L, O, 0, 1). An 8-char code gives ~1.1e12
// possibilities — long enough that join codes can't realistically be guessed,
// since a valid code lets anyone self-register as an employee of that company.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // charAt (not index access) always returns a string — keeps strict
    // noUncheckedIndexedAccess happy.
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

/**
 * Generate a join code that is not already taken. Collisions are astronomically
 * unlikely, but we check anyway and retry so the unique index never blocks a
 * legitimate registration.
 */
export async function generateUniqueJoinCode(db: Pool | PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const existing = await db.query('SELECT 1 FROM companies WHERE join_code = $1', [code]);
    if (existing.rows.length === 0) return code;
  }
  throw new Error('Failed to generate a unique join code after 5 attempts');
}
