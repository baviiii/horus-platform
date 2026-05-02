# PDF Renderer Container for Azure Container Instance
# Converts PDF pages to PNG images using Poppler

FROM node:20-slim

# Install Poppler (PDF rendering tools) and dependencies
RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
