import { PrismaClient } from '@prisma/client';

const telegramId = process.argv[2] || 'tg_5915824444';
const subscription = process.argv[3] || 'ultimate';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { telegramId },
    update: { subscription },
    create: { telegramId, subscription },
  });
  console.log('OK ->', {
    id: user.id,
    telegramId: user.telegramId,
    subscription: user.subscription,
    balance: user.balance,
  });
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
