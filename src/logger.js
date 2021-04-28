/** **************************************************************
 Copyright (C) 2021 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
******************************************************************/
// import winston for logging implementation
const { createLogger, format, transports } = require('winston');

/**
Exports central implementation of logging to be used across JS. This way logging can be consistent across the logs easily w/o repitition.

Example of this format:

2021-01-25T15:55:29 [main] INFO Generating teams for eclipsefdn-webdev/spider-pig
2021-01-25T15:55:30 [SecretReader] ERROR An unknown error occurred while reading the secret
 */
module.exports.getLogger = function(level, name = 'main') {
  return createLogger({
    level: level,
    format: format.combine(
      format.timestamp({
        format: 'YYYY-MM-DDTHH:mm:ss',
      }),
      format.printf(info => {
        return `${info.timestamp} [${name}] ${info.level.toUpperCase()} ${info.message}`;
      })),
    transports: [
      new transports.Console(),
      new transports.File({ level: 'error', filename: 'error.log' }),
    ],
  });
};
