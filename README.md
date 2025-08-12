# Jam Band Backend

A TypeScript Express.js backend service for the Jam Band application.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy the environment file:
```bash
cp .env.example .env
```

3. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3001`

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project for production
- `npm run start` - Start the production server
- `npm run clean` - Remove build artifacts
- `npm run type-check` - Check TypeScript types without building

### API Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check endpoint

## Project Structure

```
src/
├── index.ts          # Main application entry point
└── ...               # Additional features will be added here
```

## Environment Variables

- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment mode (development/production) 

## Voice Rate Limiting and WebRTC Troubleshooting

### Voice Rate Limits

The application implements rate limiting for WebRTC voice events to prevent abuse and ensure system stability:

- **voice_offer**: 60 per minute per user (1 per second)
- **voice_answer**: 60 per minute per user (1 per second)  
- **voice_ice_candidate**: 200 per minute per user (3.3 per second)

### Rate Limit Recovery

The system includes intelligent recovery mechanisms:
- Users who recently hit rate limits get additional attempts for voice recovery
- Exponential backoff is used for reconnection attempts (2s, 4s, 8s delays)
- Special bypass options for development/testing

### Troubleshooting Voice Connection Issues

#### Common Issues:

1. **"Rate limit exceeded" errors**
   - Wait for the retry timer to expire
   - Check if multiple users are rapidly connecting/disconnecting
   - Consider increasing limits for high-traffic scenarios

2. **Audience members can't hear room members**
   - Ensure audience members have enabled audio reception
   - Check browser console for WebRTC connection errors
   - Verify microphone permissions are granted

3. **Voice connections drop frequently**
   - Check network stability and firewall settings
   - Monitor WebRTC connection health logs
   - Consider adjusting connection timeout values

#### Development/Testing:

To disable voice rate limiting during development, add to your `.env.local`:
```
DISABLE_VOICE_RATE_LIMIT=true
```

#### Customizing Voice Rate Limits:

You can adjust voice rate limits based on your specific needs:

```bash
# Voice offers per minute per user (default: 60)
VOICE_OFFER_RATE_LIMIT=60

# Voice answers per minute per user (default: 60)  
VOICE_ANSWER_RATE_LIMIT=60

# ICE candidates per minute per user (default: 200)
VOICE_ICE_RATE_LIMIT=200
```

**Note**: Increasing these limits may impact system performance under high load. Monitor system resources when adjusting these values.

#### Monitoring:

Voice rate limit violations are logged with detailed information:
- User ID and event type
- Current count vs. limit
- Retry timing information
- Timestamp for debugging

### WebRTC Configuration

The system uses Google's public STUN servers for NAT traversal:
- stun:stun.l.google.com:19302
- stun:stun1.l.google.com:19302  
- stun:stun2.l.google.com:19302

For production deployments, consider adding TURN servers for better connectivity in restrictive network environments. 