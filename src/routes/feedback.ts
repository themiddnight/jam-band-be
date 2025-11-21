import { Router } from "express";
import { postFeedback, getHasSubmitted } from "../domains/feedback/handlers/FeedbackHandler";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiting for feedback endpoints
// 15 requests per minute per IP for feedback submission
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many feedback requests, please try again later",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// More lenient rate limit for checking submission status
const checkLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/feedback", feedbackLimiter, postFeedback);
router.get("/feedback/has-submitted", checkLimiter, getHasSubmitted);

export default router;

