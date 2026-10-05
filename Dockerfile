FROM node:26

COPY . /home/node/app
RUN chown -R node:node /home/node/app
WORKDIR /home/node/app
USER node
RUN npm ci
RUN mkdir db
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "scripts/healthcheck.js"]
CMD ["npm", "run", "start"]
