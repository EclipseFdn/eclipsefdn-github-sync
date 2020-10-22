FROM node:12
WORKDIR /app
ARG VERBOSE_VAL=false
ENV VERBOSE_VAL ${VERBOSE_VAL:-false}
ARG DRYRUN=false
ENV DRYRUN ${DRYRUN:-false}
ARG DRYRUN_DELETION=false
ENV DRYRUN_DELETION ${DRYRUN_DELETION:-false}

## Copy over required script files
COPY src src/

## Copy NPM configs and install dependencies
COPY package*.json ./
RUN npm ci

## run the script
CMD npm start -- --verbose=$VERBOSE_VAL --dryrun=$DRYRUN --deletionDryRun=$DRYRUN_DELETION --tls-min-v1.0