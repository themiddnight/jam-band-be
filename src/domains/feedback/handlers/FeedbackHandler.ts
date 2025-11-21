import { Request, Response } from "express";
import { FeedbackSchema, HasSubmittedQuerySchema } from "../validation/FeedbackSchemas";
import * as svc from "../services/FeedbackService";

/**
 * Mask IP address for privacy
 * IPv4: 192.168.1.123 -> 192.168.1.0
 * IPv6: Keeps first 64 bits, zeros the rest
 */
function maskIpAddress(ip: string | undefined): string | null {
  if (!ip) return null;
  
  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }
  
  // IPv6 - simplified masking
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      // Keep first 4 segments (64 bits), zero the rest
      return parts.slice(0, 4).join(':') + '::0';
    }
  }
  
  return null;
}

export const postFeedback = async (req: Request, res: Response) => {
  try {
    const dnt = req.get("DNT") === "1";
    const userAgent = dnt ? undefined : req.get("user-agent");
    const rawIp = req.ip || req.socket.remoteAddress;
    const ip = dnt ? null : maskIpAddress(rawIp);
    
    const body = FeedbackSchema.parse(req.body);
    const data = await svc.createFeedback({ 
      ...body, 
      ...(userAgent && { userAgent }),
      ...(ip !== null && { ipAddress: ip }),
    });
    
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
    console.error("Error in postFeedback:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL",
        message: "Internal server error",
      },
    });
  }
};

export const getHasSubmitted = async (req: Request, res: Response) => {
  try {
    const query = HasSubmittedQuerySchema.parse(req.query);
    const hasSubmitted = await svc.hasSubmitted(query.anonymousId);
    
    return res.json({ hasSubmitted });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "anonymousId required",
        },
      });
    }
    console.error("Error in getHasSubmitted:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL",
        message: "Internal server error",
      },
    });
  }
};

