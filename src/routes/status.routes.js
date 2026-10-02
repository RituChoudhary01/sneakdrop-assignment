import { Router } from "express";
import { statusController } from "../controllers/status.controller.js";
const router = Router();
router.get("/status/:userId", statusController);
export default router;
//# sourceMappingURL=status.routes.js.map