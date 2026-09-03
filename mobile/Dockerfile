FROM node:20-alpine

WORKDIR /app

# Install project dependencies
COPY package*.json ./
# The lockfile contains React 18 while React Native 0.86 declares a React 19
# peer; keep the lockfile reproducible but allow npm to install this existing
# dependency graph.
RUN npm ci --legacy-peer-deps

COPY . .

EXPOSE 8081
# Starts Metro bundler accepting connections from any host/device
CMD ["npx", "react-native", "start", "--host", "0.0.0.0"]
