#!/bin/bash

echo "🚀 Starting KitchZero production deployment..."

# Set environment
export NODE_ENV=production

# Pull latest code
git pull origin main

# Install dependencies
npm ci --only=production

# Run tests
npm test

# Build application
npm run build

# Run database migrations (if any)
npm run db:migrate

# Build and start production containers
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 30

# Health check
if curl -f http://localhost:8080/health; then
    echo "✅ Deployment successful!"
else
    echo "❌ Deployment failed - health check failed"
    docker-compose -f docker-compose.prod.yml logs
    exit 1
fi

echo "🎉 KitchZero is now running in production!"