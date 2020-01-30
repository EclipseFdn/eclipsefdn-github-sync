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

// variables for use with the cache
const httpCacheID = 'http.cache';
const cacheLoc = './.cache';
let httpCache = new TimeCache(httpCacheID, cacheLoc, 120);

module.exports = function() {
  this.getData = function(url) {
    // check that we haven't retrieved data yet
    var cacheResult = httpCache.getKey(url);
    if (cacheResult != null) {
      console.log(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }
    
    // return promise that returns data after caching it
    return axios.get(url)
      .then(result => {
        httpCache.setKey(url, result.data);
        
        return result.data;
      })
      .catch(err => console.log(err));
  };
  
  this.getRaw = async function(url) {
	// check that we haven't retrieved data yet
    var cacheResult = httpCache.getKey(url);
    if (cacheResult != null) {
      console.log(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }
    
    // create call that returns error or result raw, no processing
    var raw = await axios.get(url)
      .then(result => {
        httpCache.setKey(url, result);
        
        return result;
      })
      .catch(err => err);
    return raw;
  };
  
  this.close = function() {
    httpCache.save(true);
  };
}