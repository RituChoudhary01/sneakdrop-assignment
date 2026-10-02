import { Router } from "express";
import { paymentController } from "../controllers/payment.controller.js";

const router = Router();

/*
 * Fake payment endpoint.
 *
 * The assignment doesn't require a real payment provider.
 */
router.post("/payment", paymentController);

/*
 * Same handler represents an incoming provider webhook.
 */
router.post("/payment/webhook", paymentController);

export default router;