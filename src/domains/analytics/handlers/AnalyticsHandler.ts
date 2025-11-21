import { Request, Response } from "express";
import { StartSessionSchema, EndSessionSchema } from "../validation/AnalyticsSchemas";
import * as svc from "../services/AnalyticsService";

export const postStart = async (req: Request, res: Response) => {
  try {
    const body = StartSessionSchema.parse(req.body);
    const data = await svc.startSession(body);
    return res.status(201).json(data);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: error,
        },
      });
    }
    console.error("Error in postStart:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL",
        message: "Internal server error",
      },
    });
  }
};

export const postEnd = async (req: Request, res: Response) => {
  try {
    let body: unknown;
    
    // Handle sendBeacon with text/plain content-type
    if (req.headers["content-type"] === "text/plain") {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else {
      body = req.body;
    }
    
    const validatedBody = EndSessionSchema.parse(body);
    const result = await svc.endSession({
      sessionId: validatedBody.sessionId,
      ...(validatedBody.leftAt && { leftAt: validatedBody.leftAt }),
    });
    
    if ("notFound" in result && result.notFound) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Session not found",
        },
      });
    }
    
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: error,
        },
      });
    }
    console.error("Error in postEnd:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL",
        message: "Internal server error",
      },
    });
  }
};

