FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json first (for faster builds)
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --production

# Copy rest of project files
COPY . .

# Set environment for production
ENV NODE_ENV=production

# Start server
CMD ["node", "server.js"]
