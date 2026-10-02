import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { reconcile } from "./inventory.service.js";
export async function processPayment(input) {
    if (!input.eventId) {
        throw new Error("EVENT_ID_REQUIRED");
    }
    if (!Number.isInteger(input.orderId) || input.orderId <= 0) {
        throw new Error("INVALID_ORDER_ID");
    }
    const providerCreatedAt = new Date(input.providerCreatedAt);
    if (Number.isNaN(providerCreatedAt.getTime())) {
        throw new Error("INVALID_PROVIDER_DATE");
    }
    return prisma.$transaction(async (tx) => {
        /*
         * Lock the order so two payment requests cannot
         * modify the same order simultaneously.
         */
        const orders = await tx.$queryRaw `
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
         * Idempotency:
         *
         * If the exact provider event has already been processed,
         * don't apply it again.
         */
        const existingEvent = await tx.paymentEvent.findUnique({
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
         * Lock the hold.
         */
        const holds = await tx.$queryRaw `
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
         * We need the product lock for inventory-changing
         * operations.
         */
        const products = await tx.$queryRaw `
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
         * Before processing the new payment event, reconcile
         * expired holds and FIFO waitlist allocation.
         */
        await reconcile(tx, product);
        /*
         * Save the event first.
         *
         * We use a temporary outcome and update it after
         * determining what happened.
         */
        const paymentEvent = await tx.paymentEvent.create({
            data: {
                eventId: input.eventId,
                orderId: order.id,
                type: input.type,
                providerCreatedAt,
                outcome: "APPLIED",
            },
        });
        /*
         * ----------------------------------------------------
         * PENDING
         * ----------------------------------------------------
         */
        if (input.type === "PENDING") {
            /*
             * Never move an already completed payment backwards.
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
             * If the order already failed because its hold expired,
             * a late PENDING event must not revive it.
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
            return {
                outcome: "APPLIED",
                orderId: order.id,
                status: order.status,
            };
        }
        /*
         * ----------------------------------------------------
         * FAILED
         * ----------------------------------------------------
         */
        if (input.type === "FAILED") {
            /*
             * PAID cannot move backwards.
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
             * Payment failed while hold is still active.
             *
             * Release the hold and reconcile so the next
             * waiting user can receive it.
             */
            if (hold.status === "ACTIVE") {
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
             * Hold already expired/released/completed.
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
         * ----------------------------------------------------
         * SUCCEEDED
         * ----------------------------------------------------
         */
        /*
         * Already paid -> idempotent/stale.
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
         * Active hold:
         *
         * Normal successful payment.
         */
        if (hold.status === "ACTIVE" &&
            hold.expiresAt.getTime() > Date.now()) {
            await tx.order.update({
                where: {
                    id: order.id,
                },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                },
            });
            /*
             * VERY IMPORTANT:
             *
             * PAID order must no longer have an ACTIVE hold,
             * otherwise the same sneaker gets counted twice.
             */
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
         * ----------------------------------------------------
         * LATE SUCCESS
         *
         * Hold expired before payment success arrived.
         * We need to see whether the pair is still available.
         * ----------------------------------------------------
         */
        /*
         * Recalculate inventory.
         */
        const paidCount = await tx.order.count({
            where: {
                productId: product.id,
                status: "PAID",
            },
        });
        const activeHolds = await tx.$queryRaw `
        SELECT COUNT(*)::bigint AS count
        FROM "Hold"
        WHERE
          "productId" = ${product.id}
          AND "status" = 'ACTIVE'
          AND "expiresAt" > clock_timestamp()
      `;
        const currentlyTaken = paidCount + Number(activeHolds[0]?.count);
        const availableStock = product.totalStock - currentlyTaken;
        /*
         * Pair is still free.
         *
         * We can safely revive this payment.
         */
        if (hold.status === "EXPIRED" &&
            availableStock > 0) {
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
         * Pair was already allocated to somebody else.
         *
         * We cannot give the same sneaker to two people.
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
                refundReason: "Payment succeeded after hold expired and inventory was reallocated",
            },
        });
        return {
            outcome: "REFUND_REQUIRED",
            orderId: order.id,
            status: order.status,
            refundRequired: true,
        };
    }, {
        maxWait: 10000,
        timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
}
//# sourceMappingURL=payment.service.js.map