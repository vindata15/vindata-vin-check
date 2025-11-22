# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Only copy package files first (for caching)
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port Render will use
EXPOSE 10000

# Start the server
CMD ["node", "server.js"]
