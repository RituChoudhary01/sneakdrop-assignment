import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  createHold,
  reconcile,
} from "./inventory.service.js";

const PRODUCT_ID = 2;

type BuyResult =
  | {
      type: "HOLD_CREATED";
      holdId: number;
      orderId: number;
      expiresAt: Date;
      availableStock: number;
    }
  | {
      type: "ALREADY_HELD";
      holdId: number;
      orderId: number;
      expiresAt: Date;
    }
  | {
      type: "WAITLISTED";
      waitlistId: number;
      position: number;
    }
  | {
      type: "ALREADY_WAITING";
      waitlistId: number;
      position: number;
    };

export async function buySneaker(
  userId: number
): Promise<BuyResult> {
  return prisma.$transaction(
    async (tx) => {
      /*
       * PRODUCT ROW LOCK
       *
       * This serializes inventory decisions for this product.
       */
      const products = await tx.$queryRaw<
        Array<{
          id: number;
          totalStock: number;
          priceCents: number;
        }>
      >`
        SELECT
          "id",
          "totalStock",
          "priceCents"
        FROM "Product"
        WHERE "id" = ${PRODUCT_ID}
        FOR UPDATE
      `;

      const product = products[0];

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      /*
       * Verify user.
       */
      const user = await tx.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      /*
       * Reconcile expired holds + FIFO waitlist.
       *
       * IMPORTANT:
       * This happens BEFORE this new buyer gets an opportunity
       * to take inventory.
       */
      await reconcile(tx, product);

      /*
       * Maximum 2 PAID purchases.
       */
      const purchasedCount = await tx.order.count({
        where: {
          userId,
          productId: PRODUCT_ID,
          status: "PAID",
        },
      });

      if (purchasedCount >= 2) {
        throw new Error("MAX_PURCHASE_LIMIT");
      }

      /*
       * If this user already has an active hold, return the
       * existing hold instead of returning an error.
       *
       * This makes the endpoint effectively idempotent for
       * double-clicks.
       */
      const existingHold = await tx.hold.findFirst({
        where: {
          userId,
          productId: PRODUCT_ID,
          status: "ACTIVE",
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          id: "desc",
        },
      });

      if (existingHold) {
        const existingOrder = await tx.order.findFirst({
          where: {
            holdId: existingHold.id,
            status: "PENDING",
          },
          orderBy: {
            id: "desc",
          },
        });

        if (existingOrder) {
          return {
            type: "ALREADY_HELD" as const,
            holdId: existingHold.id,
            orderId: existingOrder.id,
            expiresAt: existingHold.expiresAt,
          };
        }
      }

      /*
       * Calculate current available inventory AFTER reconcile.
       */
      const paidCount = await tx.order.count({
        where: {
          productId: PRODUCT_ID,
          status: "PAID",
        },
      });

      const activeHolds = await tx.$queryRaw<
        Array<{ count: bigint }>
      >`
        SELECT COUNT(*)::bigint AS count
        FROM "Hold"
        WHERE
          "productId" = ${PRODUCT_ID}
          AND "status" = 'ACTIVE'
          AND "expiresAt" > clock_timestamp()
      `;

      const availableStock =
        product.totalStock -
        paidCount -
        Number(activeHolds[0]?.count);

      /*
       * STOCK AVAILABLE
       */
      if (availableStock > 0) {
        const hold = await createHold(
          tx,
          userId,
          PRODUCT_ID,
          "BUY"
        );

        const order = await tx.order.create({
          data: {
            holdId: hold.id,
            userId,
            productId: PRODUCT_ID,
            amountCents: product.priceCents,
            status: "PENDING",
          },
        });

        return {
          type: "HOLD_CREATED" as const,
          holdId: hold.id,
          orderId: order.id,
          expiresAt: hold.expiresAt,
          availableStock: availableStock - 1,
        };
      }

      /*
       * NO STOCK
       *
       * Join FIFO queue.
       */
      const existingWaiting =
        await tx.waitlistEntry.findFirst({
          where: {
            userId,
            productId: PRODUCT_ID,
            status: "WAITING",
          },
        });

      if (existingWaiting) {
        const position = await getWaitlistPosition(
          tx,
          existingWaiting.id,
          PRODUCT_ID
        );

        return {
          type: "ALREADY_WAITING" as const,
          waitlistId: existingWaiting.id,
          position,
        };
      }

      const waitlistEntry =
        await tx.waitlistEntry.create({
          data: {
            userId,
            productId: PRODUCT_ID,
            status: "WAITING",
          },
        });

      const position = await getWaitlistPosition(
        tx,
        waitlistEntry.id,
        PRODUCT_ID
      );

      return {
        type: "WAITLISTED" as const,
        waitlistId: waitlistEntry.id,
        position,
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

async function getWaitlistPosition(
  tx: Prisma.TransactionClient,
  entryId: number,
  productId: number
): Promise<number> {
  const result = await tx.$queryRaw<
    Array<{ position: bigint }>
  >`
    SELECT COUNT(*)::bigint AS position
    FROM "WaitlistEntry"
    WHERE
      "productId" = ${productId}
      AND "status" = 'WAITING'
      AND "id" <= ${entryId}
  `;

  return Number(result[0]?.position);
}