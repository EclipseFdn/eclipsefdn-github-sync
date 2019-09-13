# EclipseFdn GitHub Sync toolset

## Running the toolset for development

By default, the script is run in docker containers to emulate the production environment (Openshift). This sync tool can be run in standard and verbose mode. The difference between the modes is that in verbose all log messages are printed to the STDOUT of the container.

Before running, a `secret` file should be created that contains the GitHub API key to be used for connectivity. This should be created in the root folder of the project.  

- Default run: `docker-compose up --build -d`
- Verbose run: `docker run --env VERBOSE_VAL=true -d <container_name>`

## Maintainers

**Martin Lowe (Eclipse Foundation)**

- <https://github.com/autumnfound>

## Trademarks

* Eclipse® is a Trademark of the Eclipse Foundation, Inc.
* Eclipse Foundation is a Trademark of the Eclipse Foundation, Inc.

## Copyright and license

Copyright 2019 the [Eclipse Foundation, Inc.](https://www.eclipse.org) and the [eclipsefdn-github-sync authors](https://github.com/eclipsefdn/eclipsefdn-github-sync/graphs/contributors). Code released under the [Eclipse Public License Version 2.0 (EPL-2.0)](https://github.com/eclipsefdn/eclipsefdn-github-sync/blob/master/LICENSE).
