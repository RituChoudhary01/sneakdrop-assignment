type PaymentInput = {
    eventId: string;
    orderId: number;
    type: "PENDING" | "SUCCEEDED" | "FAILED";
    providerCreatedAt: string;
};
export declare function processPayment(input: PaymentInput): Promise<{
    outcome: string;
    orderId: number;
    status: string;
    refundRequired?: never;
} | {
    outcome: string;
    orderId: number;
    status: string;
    refundRequired: boolean;
}>;
export {};
//# sourceMappingURL=payment.service.d.ts.map