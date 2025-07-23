import cors from 'cors';

export const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || "http://localhost:5173"
    : "*", // Allow all origins in development
  credentials: true
};

export const corsMiddleware = cors(corsOptions); 