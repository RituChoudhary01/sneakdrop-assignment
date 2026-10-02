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

    if (
      !eventId ||
      !orderId ||
      !type ||
      !providerCreatedAt
    ) {
      return res.status(400).json({
        error:
          "eventId, orderId, type and providerCreatedAt are required",
      });
    }

    if (
      !["PENDING", "SUCCEEDED", "FAILED"].includes(type)
    ) {
      return res.status(400).json({
        error: "Invalid payment event type",
      });
    }

    const result = await processPayment({
      eventId,
      orderId: Number(orderId),
      type,
      providerCreatedAt,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      switch (error.message) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            error: "Order not found",
          });

        case "HOLD_NOT_FOUND":
          return res.status(404).json({
            error: "Hold not found",
          });

        case "PRODUCT_NOT_FOUND":
          return res.status(404).json({
            error: "Product not found",
          });

        case "EVENT_ID_REQUIRED":
        case "INVALID_ORDER_ID":
        case "INVALID_PROVIDER_DATE":
          return res.status(400).json({
            error: error.message,
          });
      }
    }

    return res.status(500).json({
      error: "Could not process payment",
    });
  }
}