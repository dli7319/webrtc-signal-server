# STAGE 1: Build
# We use a larger image with dev tools to compile the TypeScript
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package definition first to leverage Docker cache for dependencies
COPY package*.json ./

# Install ALL dependencies (including 'typescript' and '@types/*')
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the TypeScript code (assumes tsconfig.json outputs to /dist)
RUN npx tsc

# STAGE 2: Production
# We use a fresh, clean image for the final runtime
FROM node:24-alpine

WORKDIR /app

# Copy package definition again
COPY package*.json ./

# Install ONLY production dependencies (skips typescript, @types, etc.)
RUN npm ci --omit=dev

# Copy the compiled JavaScript from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the signaling port
EXPOSE 8080

# Start the server
CMD ["node", "dist/server.js"]