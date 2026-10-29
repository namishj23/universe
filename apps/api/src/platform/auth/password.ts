import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: 19 MiB memory, 2 iterations, 1 lane.
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, options);

export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

/** Verified against when the email is unknown, so timing does not reveal which accounts exist. */
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));
