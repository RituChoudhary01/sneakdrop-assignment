import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.paymentEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.user.deleteMany();
  await prisma.product.deleteMany();

  const product = await prisma.product.create({
    data: {
      slug: "limited-sneaker",
      name: "Limited Edition Sneaker",
      totalStock: 20,
      priceCents: 10000,
    },
  });

  await prisma.user.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      name: `user${i + 1}`,
    })),
  });

  const userCount = await prisma.user.count();

  console.log("Seeded product:", product);
  console.log("Seeded users:", userCount);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });