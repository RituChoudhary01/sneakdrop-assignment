const HOLD_MINUTES = 5;
const HOLD_SECONDS = HOLD_MINUTES * 60;
export async function createHold(tx, userId, productId, source) {
    const rows = await tx.$queryRaw `
    INSERT INTO "Hold"
      (
        "userId",
        "productId",
        "status",
        "source",
        "expiresAt",
        "createdAt",
        "updatedAt"
      )
    VALUES
      (
        ${userId},
        ${productId},
        'ACTIVE',
        ${source}::"HoldSource",
        clock_timestamp() + make_interval(secs => ${HOLD_SECONDS}),
        clock_timestamp(),
        clock_timestamp()
      )
    RETURNING "id", "expiresAt"
  `;
    if (!rows[0]) {
        throw new Error("HOLD_CREATION_FAILED");
    }
    return rows[0];
}
/**
 * Expire old holds and immediately allocate newly available
 * inventory to the FIFO waitlist.
 *
 * IMPORTANT:
 * Caller MUST already hold the Product row lock.
 */
export async function reconcile(tx, product) {
    /*
     * 1. Expire stale holds.
     */
    await tx.$executeRaw `
    UPDATE "Hold"
    SET
      "status" = 'EXPIRED',
      "updatedAt" = clock_timestamp()
    WHERE
      "productId" = ${product.id}
      AND "status" = 'ACTIVE'
      AND "expiresAt" <= clock_timestamp()
  `;
    /*
     * 2. PENDING orders belonging to expired holds are no longer
     *    valid payment attempts.
     */
    await tx.$executeRaw `
    UPDATE "Order" o
    SET
      "status" = 'FAILED',
      "updatedAt" = clock_timestamp()
    FROM "Hold" h
    WHERE
      o."holdId" = h."id"
      AND o."status" = 'PENDING'
      AND h."status" = 'EXPIRED'
      AND h."productId" = ${product.id}
  `;
    /*
     * 3. Calculate current inventory.
     */
    const getTakenCount = async () => {
        const paid = await tx.order.count({
            where: {
                productId: product.id,
                status: "PAID",
            },
        });
        const liveHolds = await tx.$queryRaw `
      SELECT COUNT(*)::bigint AS count
      FROM "Hold"
      WHERE
        "productId" = ${product.id}
        AND "status" = 'ACTIVE'
        AND "expiresAt" > clock_timestamp()
    `;
        return paid + Number(liveHolds[0]?.count);
    };
    /*
     * 4. Give every available pair to the FIFO queue.
     */
    let free = product.totalStock - (await getTakenCount());
    while (free > 0) {
        const next = await tx.waitlistEntry.findFirst({
            where: {
                productId: product.id,
                status: "WAITING",
            },
            orderBy: {
                id: "asc",
            },
        });
        if (!next) {
            break;
        }
        /*
         * A user who has already bought 2 pairs cannot receive
         * another pair from the queue.
         */
        const purchasedCount = await tx.order.count({
            where: {
                userId: next.userId,
                productId: product.id,
                status: "PAID",
            },
        });
        if (purchasedCount >= 2) {
            await tx.$executeRaw `
        UPDATE "WaitlistEntry"
        SET
          "status" = 'SKIPPED',
          "resolvedAt" = clock_timestamp()
        WHERE "id" = ${next.id}
      `;
            continue;
        }
        /*
         * Create a fresh 5-minute hold using PostgreSQL's clock.
         */
        const hold = await createHold(tx, next.userId, product.id, "WAITLIST");
        /*
         * Create payment order for the newly assigned hold.
         */
        await tx.order.create({
            data: {
                holdId: hold.id,
                userId: next.userId,
                productId: product.id,
                amountCents: product.priceCents,
                status: "PENDING",
            },
        });
        /*
         * Remove this person from the waiting queue.
         */
        await tx.$executeRaw `
      UPDATE "WaitlistEntry"
      SET
        "status" = 'ASSIGNED',
        "resolvedAt" = clock_timestamp()
      WHERE "id" = ${next.id}
    `;
        free--;
    }
}
//# sourceMappingURL=inventory.service.js.map