/** **************************************************************
 Copyright (C) 2019 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
******************************************************************/

/** default cache time of 2 hours */
const DEFAULT_CACHE_TIME = 120;

const axios = require('axios');
const TimeCache = require('./TimeCache.js');
const { getLogger } = require('./logger.js');

// variables for use with the cache
const httpCacheID = 'http.cache';
const cacheLoc = './.cache';

class HttpWrapper {
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'boolean') {
      this.#verbose = val;
      this.#logger = getLogger(this.#verbose ? 'debug' : 'info', 'HttpWrapper');
    }
  }
  get verbose() {
    return this.#verbose;
  }
  #logger;
  set logger(logger) {
    this.#logger = logger;
  }
  get logger() {
    return this.#logger;
  }
  #cacheTime;
  #httpCache;

  constructor(cacheTime) {
    this.#cacheTime = cacheTime | DEFAULT_CACHE_TIME;
    this.#httpCache = new TimeCache(httpCacheID, cacheLoc, this.#cacheTime);
    this.#logger = getLogger('info', 'HttpWrapper');
  }

  getData(url) {
    if (this.#verbose === true) {
      this.#logger.debug(`HTTPWrapper:getData(url = ${url})`);
    }
    // check that we haven't retrieved data yet
    var cacheResult = this.#httpCache.getKey(url);
    if (cacheResult != null) {
      this.#logger.verbose(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }

    // return promise that returns data after caching it
    return axios.get(url)
      .then(result => {
        this.#logger.silly(result);
        this.#httpCache.setKey(url, result.data);
        return result.data;
      })
      .catch(err => {
        this.#logger.error(err);
      });
  }

  async getRaw(url) {
    if (this.#verbose === true) {
      this.#logger.debug(`HTTPWrapper:getRaw(url = ${url})`);
    }
    // check that we haven't retrieved data yet
    var cacheResult = this.#httpCache.getKey(url);
    if (cacheResult != null) {
      this.#logger.verbose(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }

    // create call that returns error or result raw, no processing
    var raw = await axios.get(url)
      .then(result => {
        this.#logger.silly(result);
        this.#httpCache.setKey(url, result);
        return result;
      })
      .catch(err => {
        this.#logger.error(err);
        return err;
      });
    return raw;
  }

  close() {
    if (this.#verbose === true) {
      this.#logger.debug('HTTPWrapper:close()');
    }
    this.#httpCache.save(true);
  }
}
module.exports.HttpWrapper = HttpWrapper;
