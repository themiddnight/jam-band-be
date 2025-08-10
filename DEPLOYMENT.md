# 🚀 Railway Deployment Guide

## 📋 Prerequisites

- [Railway Account](https://railway.app/)
- [GitHub Account](https://github.com/)
- [Docker](https://www.docker.com/) (for local development)

## 🐳 Docker Setup

### Local Development with Docker

```bash
# Build and run with Docker Compose
npm run docker:dev

# Or run in detached mode
npm run docker:dev:detach

# Stop containers
npm run docker:stop

# Build Docker image
npm run docker:build

# Run Docker container
npm run docker:run
```

### Docker Commands

```bash
# Build image
docker build -t jam-band-be .

# Run container
docker run -p 3001:3001 jam-band-be

# View logs
docker logs <container_id>

# Stop container
docker stop <container_id>
```

## 🚂 Railway Setup

### 1. Install Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
npm run railway:login
# หรือ
railway login
```

### 2. Create Railway Project

```bash
# Create new project
railway init

# Or link existing project
railway link
```

### 3. Deploy to Railway

```bash
# Deploy to Railway
npm run railway:deploy
# หรือ
railway up

# View logs
npm run railway:logs
# หรือ
railway logs

# Check status
npm run railway:status
# หรือ
railway status
```

## 🔧 Environment Variables

### Railway Environment Variables

Set these in your Railway project dashboard:

```bash
NODE_ENV=production
PORT=3001
SSL_ENABLED=false
CORS_ORIGIN=https://your-app.vercel.app
WEBRTC_ENABLED=true
WEBRTC_REQUIRE_HTTPS=false
RAILWAY_URL=https://your-app.railway.app
RAILWAY_SERVICE=jam-band-backend
```

### Local Development Environment

Copy `env.local.example` to `.env.local`:

```bash
cp env.local.example .env.local
```

## 🌐 Domain & SSL

### Custom Domain

1. Go to Railway project dashboard
2. Navigate to "Settings" > "Domains"
3. Add your custom domain
4. Railway will automatically provision SSL certificate

### SSL Configuration

- **Development**: Uses self-signed certificates for WebRTC
- **Production**: Railway handles SSL termination automatically

## 📊 Monitoring & Logs

### Railway Logs

```bash
# View real-time logs
railway logs --follow

# View logs for specific service
railway logs --service backend
```

### Health Checks

The app includes health check endpoint:

```
GET /api/health
```

## 🔄 CI/CD with GitHub Actions

### Railway Token

1. Go to Railway account settings
2. Generate API token
3. Add to GitHub Secrets as `RAILWAY_TOKEN`

### GitHub Actions Workflow

```yaml
name: Deploy to Railway

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run build
    - uses: bervProject/railway-deploy@v1.0.0
      with:
        railway_token: ${{ secrets.RAILWAY_TOKEN }}
        service: ${{ secrets.RAILWAY_SERVICE }}
```

## 🚨 Troubleshooting

### Common Issues

1. **Build Failures**
   - Check Docker build logs
   - Verify all dependencies are in package.json

2. **Runtime Errors**
   - Check Railway logs
   - Verify environment variables

3. **SSL Issues**
   - Development: Check .selfsigned folder
   - Production: Railway handles SSL automatically

4. **Port Issues**
   - Railway uses PORT environment variable
   - Default: 3001

### Debug Commands

```bash
# Check Railway status
railway status

# View service logs
railway logs

# Check environment variables
railway variables

# Restart service
railway restart
```

## 📱 Frontend Integration

### Update Frontend Environment

```bash
# .env.production
VITE_API_BASE_URL=https://your-app.railway.app
VITE_SOCKET_URL=https://your-app.railway.app
```

### CORS Configuration

Ensure CORS_ORIGIN in Railway matches your frontend domain.

## 🔐 Security

### Production Security

- Helmet.js for security headers
- CORS properly configured
- Non-root user in Docker container
- Environment variables for sensitive data

### SSL/TLS

- Railway automatically handles SSL termination
- Custom domains get free SSL certificates
- WebRTC works without manual SSL setup

## 📈 Scaling

### Railway Scaling

- Automatic scaling based on traffic
- Manual scaling in dashboard
- Multiple regions available

### Performance Tips

- Use multi-stage Docker builds
- Optimize dependencies
- Enable compression middleware
- Use connection pooling for databases

## 🆘 Support

- [Railway Documentation](https://docs.railway.app/)
- [Railway Discord](https://discord.gg/railway)
- [GitHub Issues](https://github.com/your-repo/issues) 