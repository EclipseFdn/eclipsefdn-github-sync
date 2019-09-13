/****************************************************************************
 Copyright (C) 2019 Eclipse Foundation, Inc.
 
 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/
 
  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>
    
 SPDX-License-Identifier: EPL-2.0
 
 Special thanks to Pokuan Ho for kindly providing permission to use 
 [cache.js](https://gist.github.com/p1ho/1c7d81db13be872440699202fef1c474) 
 under the terms of the [MIT license](https://opensource.org/licenses/MIT).
  
 The aforementioned file forms the base in which this class was implemented.
 ****************************************************************************/

const flatCache = require('flat-cache');
let cache, expire;

module.exports = function(name, path, cacheTime = 0) {
  this.cache = flatCache.load(name, path);
  this.expire = cacheTime === 0 ? false : cacheTime * 1000 * 60;
  
  this.getKey = function(key) {
    var now = new Date().getTime();
    var value = this.cache.getKey(key);
    if (value === undefined || (value.expire !== false && value.expire < now)) {
      return undefined;
    } else {
      return value.data;
    }
  };
  
  this.setKey = function(key, value) {
    var now = new Date().getTime()
    this.cache.setKey(key, {
      expire: this.expire === false ? false : now + this.expire,
      data: value
    });
  };
  
  this.save = function(prune = false) {
    if (prune === true) {
      var now = new Date().getTime();
      for (obj in this.cache.all()) {
        var cached = this.cache.getKey(obj);
        if (cached.expire !== false && cached.expire < now) {
          this.cache.removeKey(obj);
        }
      }
    }
    this.cache.save(true);
  };
}