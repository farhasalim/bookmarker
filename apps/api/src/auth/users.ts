import type { Db } from '@bookmarker/db';

/**
 * Finds the user for a verified email, creating them on first sign-in, and links
 * the identity (Google subject or email). Emails are matched case-insensitively.
 */
export async function findOrCreateUser(
  db: Db,
  input: {
    email: string;
    name?: string | undefined;
    avatarUrl?: string | undefined;
    provider: 'google' | 'email';
    subject: string;
  },
): Promise<{ id: string; deleted: boolean }> {
  const email = input.email.trim().toLowerCase();
  return db.$transaction(async (tx) => {
    const identity = await tx.authIdentity.findUnique({
      where: {
        provider_providerSubject: { provider: input.provider, providerSubject: input.subject },
      },
      select: { user: { select: { id: true, deletedAt: true } } },
    });
    if (identity) return { id: identity.user.id, deleted: identity.user.deletedAt !== null };

    const user =
      (await tx.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } })) ??
      (await tx.user.create({
        data: {
          email,
          name: input.name?.trim() || email.split('@')[0]!.slice(0, 80),
          avatarUrl: input.avatarUrl ?? null,
        },
        select: { id: true, deletedAt: true },
      }));
    await tx.authIdentity.create({
      data: { userId: user.id, provider: input.provider, providerSubject: input.subject },
    });
    return { id: user.id, deleted: user.deletedAt !== null };
  });
}
