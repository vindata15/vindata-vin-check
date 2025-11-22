FROM node:20-slim

WORKDIR /app

# Install ONLY package dependencies first (for caching)
COPY package*.json ./

RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
