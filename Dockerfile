FROM node:10
WORKDIR /app
ARG VERBOSE_VAL=false
ENV VERBOSE_VAL ${VERBOSE_VAL:-false}
ARG DRYRUN=false
ENV DRYRUN ${DRYRUN:-false}

## Copy NPM configs and install dependencies
COPY package*.json ./
RUN npm install

## Copy over required script files
COPY ./src/* ./src/

## run the script
CMD npm start -- --verbose=$VERBOSE_VAL --dryrun=$DRYRUN
