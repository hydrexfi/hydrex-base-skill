import "dotenv/config";
import express from "express";
import cors from "cors";
import stateRouter from "./routes/state";
import prepareRouter from "./routes/prepare";

const app = express();
const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = (process.env.CORS_ORIGINS ?? "*")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET"],
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hydrex-base-skill-server", chainId: 8453 });
});

app.use("/state", stateRouter);
app.use("/prepare", prepareRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(port, () => {
  console.log(`hydrex-base-skill server running on http://localhost:${port}`);
});

export default app;
