import { prisma } from "../prisma.js";
const PRODUCT_ID = 1;
export async function getUserStatus(userId) {
    /*
     * Get product.
     */
    const product = await prisma.product.findUnique({
        where: {
            id: PRODUCT_ID,
        },
    });
    if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
    }
    /*
     * Check user.
     */
    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
    });
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }
    /*
     * Expire stale holds before calculating status.
     *
     * We use PostgreSQL clock_timestamp() so the status page
     * doesn't show an expired hold as still active.
     */
    await prisma.$executeRaw `
    UPDATE "Hold"
    SET
      "status" = 'EXPIRED',
      "updatedAt" = clock_timestamp()
    WHERE
      "productId" = ${PRODUCT_ID}
      AND "status" = 'ACTIVE'
      AND "expiresAt" <= clock_timestamp()
  `;
    /*
     * Number of successfully purchased pairs.
     */
    const purchasedCount = await prisma.order.count({
        where: {
            userId,
            productId: PRODUCT_ID,
            status: "PAID",
        },
    });
    /*
     * Number of all paid pairs.
     */
    const paidCount = await prisma.order.count({
        where: {
            productId: PRODUCT_ID,
            status: "PAID",
        },
    });
    /*
     * Currently active holds.
     */
    const activeHoldCount = await prisma.$queryRaw `
    SELECT COUNT(*)::bigint AS count
    FROM "Hold"
    WHERE
      "productId" = ${PRODUCT_ID}
      AND "status" = 'ACTIVE'
      AND "expiresAt" > clock_timestamp()
  `;
    const activeHolds = Number(activeHoldCount[0]?.count);
    /*
     * Remaining stock.
     */
    const pairsLeft = Math.max(0, product.totalStock - paidCount - activeHolds);
    /*
     * User's current active hold.
     */
    const activeHold = await prisma.$queryRaw `
    SELECT
      "id",
      "expiresAt"
    FROM "Hold"
    WHERE
      "userId" = ${userId}
      AND "productId" = ${PRODUCT_ID}
      AND "status" = 'ACTIVE'
      AND "expiresAt" > clock_timestamp()
    ORDER BY "id" DESC
    LIMIT 1
  `;
    let hold = null;
    if (activeHold.length > 0) {
        const seconds = await prisma.$queryRaw `
      SELECT GREATEST(
        0,
        EXTRACT(
          EPOCH FROM (
            ${activeHold[0]?.expiresAt} - clock_timestamp()
          )
        )
      )::float AS seconds
    `;
        hold = {
            id: activeHold[0]?.id,
            expiresAt: activeHold[0]?.expiresAt,
            remainingSeconds: Math.floor(Number(seconds[0]?.seconds)),
        };
    }
    /*
     * User's current waitlist entry.
     */
    const waitlistEntry = await prisma.waitlistEntry.findFirst({
        where: {
            userId,
            productId: PRODUCT_ID,
            status: "WAITING",
        },
        orderBy: {
            id: "asc",
        },
    });
    let waitlist = null;
    if (waitlistEntry) {
        const position = await prisma.waitlistEntry.count({
            where: {
                productId: PRODUCT_ID,
                status: "WAITING",
                id: {
                    lte: waitlistEntry.id,
                },
            },
        });
        waitlist = {
            id: waitlistEntry.id,
            position,
        };
    }
    /*
     * Return complete status.
     */
    return {
        product: {
            id: product.id,
            name: product.name,
            priceCents: product.priceCents,
            totalStock: product.totalStock,
        },
        pairsLeft,
        purchasedCount,
        canPurchase: purchasedCount < 2 && !hold,
        hold,
        waitlist,
    };
}
//# sourceMappingURL=status.service.js.map