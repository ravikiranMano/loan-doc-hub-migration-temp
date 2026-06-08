import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const count = await prisma.templates.count();
  const rows = await prisma.templates.findMany({
    where: {
      OR: [
        { name: { contains: '851a', mode: 'insensitive' } },
        { name: { contains: 're851a', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      state: true,
      product_type: true,
      version: true,
      file_path: true,
      is_active: true,
    },
  });
  console.log(JSON.stringify({ count, rows }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
