import cors from 'cors';

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Log the origin for debugging
    console.log('🔒 CORS: Request origin:', origin);
    console.log('🔒 CORS: NODE_ENV:', process.env.NODE_ENV);
    console.log('🔒 CORS: FRONTEND_URL:', process.env.FRONTEND_URL);
    
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = [
        'https://jam-band-fe.vercel.app',
        'http://localhost:5173'
      ];
      
      if (!origin || allowedOrigins.includes(origin)) {
        console.log('✅ CORS: Origin allowed:', origin);
        callback(null, true);
      } else {
        console.log('❌ CORS: Origin blocked:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development mode - allow all origins
      console.log('🔓 CORS: Development mode - allowing all origins');
      callback(null, true);
    }
  },
  credentials: true
};

export const corsMiddleware = cors(corsOptions); 