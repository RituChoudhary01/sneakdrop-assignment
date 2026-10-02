type BuyResult = {
    type: "HOLD_CREATED";
    holdId: number;
    orderId: number;
    expiresAt: Date;
    availableStock: number;
} | {
    type: "ALREADY_HELD";
    holdId: number;
    orderId: number;
    expiresAt: Date;
} | {
    type: "WAITLISTED";
    waitlistId: number;
    position: number;
} | {
    type: "ALREADY_WAITING";
    waitlistId: number;
    position: number;
};
export declare function buySneaker(userId: number): Promise<BuyResult>;
export {};
//# sourceMappingURL=buy.service.d.ts.map