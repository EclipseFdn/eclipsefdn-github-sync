# eclipsefdn-github-sync

## Running the toolset for development

By default, the script is run in docker containers to emulate the production environment (Openshift). This sync tool can be run in standard and verbose mode. The difference between the modes is that in verbose all log messages are printed to the STDOUT of the container.

Before running, an `api-token` file should be created that contains the GitHub API key to be used for connectivity. This should be created in a `secret` folder in the root of the project (this has been excluded from Git commits so there is less danger of pushing live keys to a public repository).

Additionally, an eclipse-oauth-config should be created when running the GitLab sync script. This file will define how connections to the Eclipse OAuth server should be handled. If this is missing, the GitLab sync script will fail. The file should be in JSON format, with the following being an example of format:

```
{"oauth":{"timeout":3600, "client_id":"<client id>","client_secret":"<client secret>","endpoint":"https://accounts.eclipse.org","scope":"eclipsefdn_view_all_profiles","redirect":"http://localhost"}}
```


```
docker build -f Dockerfile -t ef/gh-test .
docker run -i --rm -v <fullpath to current project folder>/secrets:/run/secrets --env DRYRUN=true ef/gh-test
```

## Maintainers

**Martin Lowe (Eclipse Foundation)**

- <https://github.com/autumnfound>

## Trademarks

* Eclipse® is a Trademark of the Eclipse Foundation, Inc.
* Eclipse Foundation is a Trademark of the Eclipse Foundation, Inc.

## Copyright and license

Copyright 2019 the [Eclipse Foundation, Inc.](https://www.eclipse.org) and the [eclipsefdn-github-sync authors](https://github.com/eclipsefdn/eclipsefdn-github-sync/graphs/contributors). Code released under the [Eclipse Public License Version 2.0 (EPL-2.0)](https://github.com/eclipsefdn/eclipsefdn-github-sync/blob/master/LICENSE).
