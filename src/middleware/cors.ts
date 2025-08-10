import cors from 'cors';

export const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [
        process.env.FRONTEND_URL || "https://jam-band-fe.vercel.app",
        "http://localhost:5173" // สำหรับ development
      ]
    : "*",
  credentials: true
};

export const corsMiddleware = cors(corsOptions); 