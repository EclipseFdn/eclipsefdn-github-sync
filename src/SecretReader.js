/** ***************************************************************
 Copyright (C) 2020 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
******************************************************************/

const { getLogger } = require('./logger.js');
const fs = require('fs');
const baseConfig = {
  root: '/run/secrets/',
  encoding: 'utf-8',
};

/**
 * Contains functionality for reading secret files in and returning them
 * to the user. This defaults to the location used in Kubernetes containers
 * for secrets. This can be configured by passing an object with updated values.
 *
 * Multiple secrets can be read using the same reader assuming that they are
 * in the same directory. Additional secrets would need to be read in using a
 * new reader in such a case.
 */
class SecretReader {
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'boolean') {
      this.#verbose = val;
      this.#logger = getLogger(this.#verbose ? 'debug' : 'info', 'SecretReader');
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
  #config;
  constructor(config) {
    // check that our config exists or isn't unset. Deep cloning not needed
    if (config !== undefined && config !== null) {
      this.#config = Object.assign({}, baseConfig, config);
    } else {
      this.#config = Object.assign({}, baseConfig);
    }
    // throws if there is no access
    fs.accessSync(this.#config.root, fs.constants.R_OK);
    this.#logger = getLogger('info', 'SecretReader');
  }

  readSecret = function(name, encoding = this.#config.encoding) {
    if (this.#verbose === true) {
      this.#logger.debug(`SecretReader:readSecret(name = ${name}, encoding = ${encoding})`);
    }
    var filepath = `${this.#config.root}/${name}`;
    try {
      var data = fs.readFileSync(filepath, { encoding: encoding });
      if (data !== undefined && (data = data.trim()) !== '') {
        return data;
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.#logger.error(`File at path ${filepath} does not exist`);
      } else if (err.code === 'EACCES') {
        this.#logger.error(`File at path ${filepath} cannot be read`);
      } else {
        this.#logger.error('An unknown error occurred while reading the secret');
      }
    }
    return null;
  };
}

/**
 * Get modifiable deep copy of the base configuration for this class.
 */
function getBaseConfig() {
  return JSON.parse(JSON.stringify(baseConfig));
}

module.exports.SecretReader = SecretReader;
module.exports.getBaseConfig = getBaseConfig;
