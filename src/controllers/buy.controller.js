import { buySneaker } from "../services/buy.service.js";
export async function buyController(req, res) {
    try {
        const userId = Number(req.body.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({
                error: "Valid userId is required",
            });
        }
        const result = await buySneaker(userId);
        return res.status(200).json(result);
    }
    catch (error) {
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
                case "MAX_PURCHASE_LIMIT":
                    return res.status(409).json({
                        error: "Maximum purchase limit of 2 reached",
                    });
                case "HOLD_CREATION_FAILED":
                    return res.status(500).json({
                        error: "Could not create hold",
                    });
            }
        }
        return res.status(500).json({
            error: "Could not process purchase",
        });
    }
}
//# sourceMappingURL=buy.controller.js.map