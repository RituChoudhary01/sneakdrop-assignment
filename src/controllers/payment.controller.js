import { Request, Response } from "express";
import { processPayment } from "../services/payment.service.js";

export async function paymentController(
  req: Request,
  res: Response
) {
  try {
    const {
      eventId,
      orderId,
      type,
      providerCreatedAt,
    } = req.body;

    const result = await processPayment({
      eventId,
      orderId: Number(orderId),
      type,
      providerCreatedAt,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Payment error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "PAYMENT_FAILED";

    const statusMap: Record<string, number> = {
      EVENT_ID_REQUIRED: 400,
      INVALID_ORDER_ID: 400,
      INVALID_PROVIDER_DATE: 400,
      ORDER_NOT_FOUND: 404,
      HOLD_NOT_FOUND: 404,
      PRODUCT_NOT_FOUND: 404,
    };

    return res.status(
      statusMap[message] ?? 500
    ).json({
      error: message,
    });
  }
}