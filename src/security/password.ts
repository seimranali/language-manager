import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** Spends the same time as a real check so unknown mobiles are not distinguishable. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("timing-equalisation");
  await verifyPassword(await dummy, password);
}
