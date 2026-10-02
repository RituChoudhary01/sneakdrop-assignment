import { Request, Response } from "express";
import { getUserStatus } from "../services/status.service.js";

export async function statusController(
  req: Request,
  res: Response
) {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        error: "Valid userId is required",
      });
    }

    const result = await getUserStatus(userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      switch (error.message) {
        case "PRODUCT_NOT_FOUND":
          return res.status(404).json({
            error: "Product not found",
          });

        case "USER_NOT_FOUND":
          return res.status(404).json({
            error: "User not found",
          });
      }
    }

    return res.status(500).json({
      error: "Could not fetch status",
    });
  }
}