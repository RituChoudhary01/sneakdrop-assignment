import { prisma } from "../prisma.js";

const PRODUCT_ID = 2;

export async function getUserStatus(userId: number) {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: {
        id: userId
      }
    });

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }


    /*
     * Expire old holds.
     */
    await tx.hold.updateMany({
      where: {
        userId,
        productId: PRODUCT_ID,
        status: "ACTIVE",
        expiresAt: {
          lte: new Date()
        }
      },
      data: {
        status: "EXPIRED"
      }
    });


    /*
     * Get product.
     */
    const product = await tx.product.findUnique({
      where: {
        id: PRODUCT_ID
      }
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }


    /*
     * Purchased count.
     */
    const purchasedCount =
      await tx.order.count({
        where: {
          userId,
          productId: PRODUCT_ID,
          status: "PAID"
        }
      });


    /*
     * Active hold.
     *
     * IMPORTANT:
     * Return pending orderId so frontend
     * can send payment event.
     */
    const activeHold =
      await tx.hold.findFirst({
        where: {
          userId,
          productId: PRODUCT_ID,
          status: "ACTIVE",
          expiresAt: {
            gt: new Date()
          }
        },

        orderBy: {
          id: "desc"
        },

        select: {
          id: true,
          expiresAt: true,

          orders: {
            where: {
              status: "PENDING"
            },

            orderBy: {
              id: "desc"
            },

            take: 1,

            select: {
              id: true
            }
          }
        }
      });


    /*
     * Count active holds.
     */
    const activeHoldCount =
      await tx.hold.count({
        where: {
          productId: PRODUCT_ID,
          status: "ACTIVE",
          expiresAt: {
            gt: new Date()
          }
        }
      });


    /*
     * Count paid orders.
     */
    const paidCount =
      await tx.order.count({
        where: {
          productId: PRODUCT_ID,
          status: "PAID"
        }
      });


    /*
     * Remaining pairs.
     */
    const pairsLeft = Math.max(
      0,
      product.totalStock -
        paidCount -
        activeHoldCount
    );


    /*
     * Waitlist position.
     */
    const waitlistEntry =
      await tx.waitlistEntry.findFirst({
        where: {
          userId,
          productId: PRODUCT_ID,
          status: "WAITING"
        },

        orderBy: {
          createdAt: "asc"
        },

        select: {
          id: true,
          createdAt: true
        }
      });


    let waitlist = null;


    if (waitlistEntry) {
      const aheadCount =
        await tx.waitlistEntry.count({
          where: {
            productId: PRODUCT_ID,
            status: "WAITING",

            OR: [
              {
                createdAt: {
                  lt: waitlistEntry.createdAt
                }
              },

              {
                createdAt:
                  waitlistEntry.createdAt,

                id: {
                  lt: waitlistEntry.id
                }
              }
            ]
          }
        });


      waitlist = {
        position: aheadCount + 1
      };
    }


    let hold = null;


    if (activeHold) {
      const orderId =
        activeHold.orders.length > 0
          ? activeHold.orders[0].id
          : null;


      const remainingSeconds =
        Math.max(
          0,
          Math.floor(
            (
              activeHold.expiresAt.getTime() -
              Date.now()
            ) / 1000
          )
        );


      hold = {
        id: activeHold.id,
        orderId,
        expiresAt: activeHold.expiresAt,
        remainingSeconds
      };
    }


    return {
      pairsLeft,
      purchasedCount,
      hold,
      waitlist
    };
  });


  return result;
}