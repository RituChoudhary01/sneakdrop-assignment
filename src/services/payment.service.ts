import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { reconcile } from "./inventory.service.js";

type PaymentInput = {
  eventId: string;
  orderId: number;
  type: "PENDING" | "SUCCEEDED" | "FAILED";
  providerCreatedAt: string;
};

export async function processPayment(
  input: PaymentInput
) {
  if (!input.eventId?.trim()) {
    throw new Error("EVENT_ID_REQUIRED");
  }

  if (
    !Number.isInteger(input.orderId) ||
    input.orderId <= 0
  ) {
    throw new Error("INVALID_ORDER_ID");
  }

  const providerCreatedAt = new Date(
    input.providerCreatedAt
  );

  if (Number.isNaN(providerCreatedAt.getTime())) {
    throw new Error("INVALID_PROVIDER_DATE");
  }

  return prisma.$transaction(
    async (tx) => {
      /*
       * Lock order.
       *
       * This prevents two concurrent payment events from
       * changing the same order at the same time.
       */
      const orders = await tx.$queryRaw<
        Array<{
          id: number;
          holdId: number;
          userId: number;
          productId: number;
          amountCents: number;
          status: string;
        }>
      >`
        SELECT
          "id",
          "holdId",
          "userId",
          "productId",
          "amountCents",
          "status"
        FROM "Order"
        WHERE "id" = ${input.orderId}
        FOR UPDATE
      `;

      const order = orders[0];

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      /*
       * Exact event id already processed.
       */
      const existingEvent =
        await tx.paymentEvent.findUnique({
          where: {
            eventId: input.eventId,
          },
        });

      if (existingEvent) {
        return {
          outcome: "IGNORED_DUPLICATE",
          orderId: order.id,
          status: order.status,
        };
      }

      /*
       * Lock hold.
       */
      const holds = await tx.$queryRaw<
        Array<{
          id: number;
          userId: number;
          productId: number;
          status: string;
          expiresAt: Date;
        }>
      >`
        SELECT
          "id",
          "userId",
          "productId",
          "status",
          "expiresAt"
        FROM "Hold"
        WHERE "id" = ${order.holdId}
        FOR UPDATE
      `;

      const hold = holds[0];

      if (!hold) {
        throw new Error("HOLD_NOT_FOUND");
      }

      /*
       * Lock product.
       *
       * All inventory-changing decisions for this product
       * are serialized around this row.
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
        WHERE "id" = ${order.productId}
        FOR UPDATE
      `;

      const product = products[0];

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      /*
       * Reconcile expired holds and FIFO waitlist.
       */
      await reconcile(tx, product);

      /*
       * Save provider event.
       */
      const paymentEvent =
        await tx.paymentEvent.create({
          data: {
            eventId: input.eventId,
            orderId: order.id,
            type: input.type,
            providerCreatedAt,
            outcome: "APPLIED",
          },
        });

      /*
       * --------------------------------------------------
       * PENDING
       * --------------------------------------------------
       */
      if (input.type === "PENDING") {
        if (
          order.status === "PAID" ||
          order.status === "FAILED"
        ) {
          await tx.paymentEvent.update({
            where: {
              id: paymentEvent.id,
            },
            data: {
              outcome: "IGNORED_STALE",
            },
          });

          return {
            outcome: "IGNORED_STALE",
            orderId: order.id,
            status: order.status,
          };
        }

        return {
          outcome: "APPLIED",
          orderId: order.id,
          status: order.status,
        };
      }

      /*
       * --------------------------------------------------
       * FAILED
       * --------------------------------------------------
       */
      if (input.type === "FAILED") {
        /*
         * A paid order must never go backwards.
         */
        if (order.status === "PAID") {
          await tx.paymentEvent.update({
            where: {
              id: paymentEvent.id,
            },
            data: {
              outcome: "IGNORED_STALE",
            },
          });

          return {
            outcome: "IGNORED_STALE",
            orderId: order.id,
            status: "PAID",
          };
        }

        /*
         * Already failed.
         */
        if (order.status === "FAILED") {
          await tx.paymentEvent.update({
            where: {
              id: paymentEvent.id,
            },
            data: {
              outcome: "IGNORED_STALE",
            },
          });

          return {
            outcome: "IGNORED_STALE",
            orderId: order.id,
            status: "FAILED",
          };
        }

        /*
         * Payment failed while hold is active.
         *
         * Release inventory immediately and promote waitlist.
         */
        if (
          hold.status === "ACTIVE" &&
          hold.expiresAt.getTime() > Date.now()
        ) {
          await tx.order.update({
            where: {
              id: order.id,
            },
            data: {
              status: "FAILED",
            },
          });

          await tx.hold.update({
            where: {
              id: hold.id,
            },
            data: {
              status: "RELEASED",
            },
          });

          await reconcile(tx, product);

          return {
            outcome: "APPLIED",
            orderId: order.id,
            status: "FAILED",
          };
        }

        /*
         * Hold is already expired/released.
         */
        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: "FAILED",
          },
        });

        return {
          outcome: "APPLIED",
          orderId: order.id,
          status: "FAILED",
        };
      }

      /*
       * --------------------------------------------------
       * SUCCEEDED
       * --------------------------------------------------
       */

      /*
       * Already paid.
       */
      if (order.status === "PAID") {
        await tx.paymentEvent.update({
          where: {
            id: paymentEvent.id,
          },
          data: {
            outcome: "IGNORED_STALE",
          },
        });

        return {
          outcome: "IGNORED_STALE",
          orderId: order.id,
          status: "PAID",
        };
      }

      /*
       * Normal success:
       *
       * Hold is still valid.
       */
      const now = Date.now();

      if (
        hold.status === "ACTIVE" &&
        hold.expiresAt.getTime() > now
      ) {
        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: "PAID",
            paidAt: new Date(),
          },
        });

        await tx.hold.update({
          where: {
            id: hold.id,
          },
          data: {
            status: "COMPLETED",
          },
        });

        return {
          outcome: "APPLIED",
          orderId: order.id,
          status: "PAID",
        };
      }

      /*
       * --------------------------------------------------
       * LATE SUCCESS
       * --------------------------------------------------
       *
       * The original hold expired.
       *
       * If inventory is still available, revive the order.
       * Otherwise require refund.
       */

      const paidCount =
        await tx.order.count({
          where: {
            productId: product.id,
            status: "PAID",
          },
        });

      const activeHolds =
        await tx.$queryRaw<
          Array<{ count: bigint }>
        >`
          SELECT COUNT(*)::bigint AS count
          FROM "Hold"
          WHERE "productId" = ${product.id}
            AND "status" = 'ACTIVE'
            AND "expiresAt" > clock_timestamp()
        `;

      const currentlyTaken =
        paidCount +
        Number(activeHolds[0]?.count ?? 0);

      const availableStock =
        product.totalStock - currentlyTaken;

      /*
       * Revive if a pair is still available.
       */
      if (
        hold.status === "EXPIRED" &&
        availableStock > 0
      ) {
        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: "PAID",
            paidAt: new Date(),
          },
        });

        await tx.hold.update({
          where: {
            id: hold.id,
          },
          data: {
            status: "COMPLETED",
          },
        });

        await tx.paymentEvent.update({
          where: {
            id: paymentEvent.id,
          },
          data: {
            outcome: "APPLIED_REVIVED",
          },
        });

        return {
          outcome: "APPLIED_REVIVED",
          orderId: order.id,
          status: "PAID",
        };
      }

      /*
       * No inventory remains.
       *
       * We cannot oversell.
       */
      await tx.paymentEvent.update({
        where: {
          id: paymentEvent.id,
        },
        data: {
          outcome: "REFUND_REQUIRED",
        },
      });

      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          refundStatus: "REQUESTED",
          refundReason:
            "Payment succeeded after hold expired and inventory was reallocated",
        },
      });

      return {
        outcome: "REFUND_REQUIRED",
        orderId: order.id,
        status: order.status,
        refundRequired: true,
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