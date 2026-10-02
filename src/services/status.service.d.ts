export declare function getUserStatus(userId: number): Promise<{
    product: {
        id: number;
        name: string;
        priceCents: number;
        totalStock: number;
    };
    pairsLeft: number;
    purchasedCount: number;
    canPurchase: boolean;
    hold: {
        id: number | undefined;
        expiresAt: Date | undefined;
        remainingSeconds: number;
    } | null;
    waitlist: {
        id: number;
        position: number;
    } | null;
}>;
//# sourceMappingURL=status.service.d.ts.map