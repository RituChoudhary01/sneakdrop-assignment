import { Prisma } from "@prisma/client";
type ProductForInventory = {
    id: number;
    totalStock: number;
    priceCents: number;
};
export declare function createHold(tx: Prisma.TransactionClient, userId: number, productId: number, source: "BUY" | "WAITLIST"): Promise<{
    id: number;
    expiresAt: Date;
}>;
/**
 * Expire old holds and immediately allocate newly available
 * inventory to the FIFO waitlist.
 *
 * IMPORTANT:
 * Caller MUST already hold the Product row lock.
 */
export declare function reconcile(tx: Prisma.TransactionClient, product: ProductForInventory): Promise<void>;
export {};
//# sourceMappingURL=inventory.service.d.ts.map