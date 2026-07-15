# Use Node 20 (Debian-based so apt-get works)
FROM node:22-bookworm-slim

# Install ffmpeg (needed for RTSP -> HLS)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package.json package-lock.json* ./

# Install all dependencies (faster + reproducible if lock exists)
RUN npm ci || npm install

# Copy all source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose server port (match your backend PORT)
EXPOSE 5000

# Start server
CMD ["npm", "start"]
