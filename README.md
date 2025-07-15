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