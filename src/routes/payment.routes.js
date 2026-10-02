import { Router } from "express";
import { paymentController } from "../controllers/payment.controller.js";

const router = Router();

router.post(
  "/payment",
  paymentController
);

export default router;