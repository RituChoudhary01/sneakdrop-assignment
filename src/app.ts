import express from "express";
import cors from "cors";

import buyRoutes from "./routes/buy.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import statusRoutes from "./routes/status.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", buyRoutes);
app.use("/api", paymentRoutes);
app.use("/api", statusRoutes);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

export default app;