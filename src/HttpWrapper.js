/****************************************************************
 Copyright (C) 2019 Eclipse Foundation, Inc.
 
 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/
 
  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>
    
 SPDX-License-Identifier: EPL-2.0
******************************************************************/

const axios = require('axios');

const TimeCache = require('./TimeCache.js');
const winston = require('winston');

// variables for use with the cache
const httpCacheID = 'http.cache';
const cacheLoc = './.cache';
let httpCache = new TimeCache(httpCacheID, cacheLoc, 120);

module.exports = function() {
  this.getData = function(url) {
    // check that we haven't retrieved data yet
    var cacheResult = httpCache.getKey(url);
    if (cacheResult != null) {
      winston.debug(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }
    
    // return promise that returns data after caching it
    return axios.get(url)
      .then(result => {
        httpCache.setKey(url, result.data);
        
        return result.data;
      })
      .catch(err => winston.error(err));
  };
  
  this.close = function() {
    httpCache.save(true);
  };
}