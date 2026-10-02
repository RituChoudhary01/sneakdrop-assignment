import { Router } from "express";
import { buyController } from "../controllers/buy.controller.js";
const router = Router();
router.post("/buy", buyController);
export default router;
//# sourceMappingURL=buy.routes.js.map