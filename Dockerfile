FROM node:14

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm i

COPY . .

RUN npm run build

EXPOSE 3000
CMD [ "node", "build/index.js" ]
