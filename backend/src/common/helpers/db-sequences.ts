import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type DbClient = PrismaService | Prisma.TransactionClient;

/** Calls `generate_deal_number()` DB function. */
export async function generateDealNumber(prisma: DbClient): Promise<string> {
  const rows = await prisma.$queryRaw<{ generate_deal_number: string }[]>`
    SELECT generate_deal_number() AS generate_deal_number
  `;
  return rows[0].generate_deal_number;
}

/** Calls `generate_contact_id(p_type)` DB function. */
export async function generateContactId(
  prisma: DbClient,
  contactType: string,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ generate_contact_id: string }[]>`
    SELECT generate_contact_id(${contactType}::text) AS generate_contact_id
  `;
  return rows[0].generate_contact_id;
}
