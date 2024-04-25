FROM node:20-alpine

WORKDIR /usr/src/app
COPY package*.json ./

# Bundle app source
COPY . .


# TODO(apoorveth): npm install --production isn't working, need to set that up
RUN npm install

EXPOSE 3000

CMD ["npm", "start"]