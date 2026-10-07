FROM node:22-alpine
WORKDIR /agent
COPY package.json agent.mjs ./
COPY lib ./lib
VOLUME /data
ENV NODE_ENV=production
CMD ["node", "agent.mjs", "/data/edge.config.json"]
