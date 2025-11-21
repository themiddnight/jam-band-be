import { Router } from "express";
import { postStart, postEnd } from "../domains/analytics/handlers/AnalyticsHandler";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiting for analytics endpoints
// 60 requests per minute per IP
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/analytics/session/start", analyticsLimiter, postStart);
router.post("/analytics/session/end", analyticsLimiter, postEnd);

export default router;

