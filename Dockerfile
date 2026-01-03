FROM node:22

COPY . /home/node/app
RUN chown -R node:node /home/node/app
WORKDIR /home/node/app
USER node
RUN npm ci
RUN mkdir db
CMD ["npm", "run", "start"]
