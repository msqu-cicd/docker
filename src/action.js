import * as core from '@actions/core';
import * as github from '@actions/github';
import * as action_information from 'information';
import {
  addCiRegistryAuth,
  collectTags, executeDockerBuild,
  mergeArgRegistryAuthJson,
  prepareDestinations, prepareDockerArgs,
  processAdditionalRegistries,
  writeRegistryAuthJson
} from './lib';


try {
  const information = action_information.collect_all(true, false);
  let debug         = core.getInput('debug') != null ? (!!core.getInput('debug')) : true;
  console.log('debug=', debug);
  debug = true;

  let targetRegistries = [];
  const repoStr        = github.context.repo.owner + '/' + github.context.repo.repo;

  let ci_registry = false;
  if (core.getBooleanInput('add_ci_registry_target')) {
    ci_registry = information.ci_hostname + '/' + repoStr;
    targetRegistries.push(ci_registry);
  }

  processAdditionalRegistries();
  const registryAuthJson = {auths: {}};
  addCiRegistryAuth(ci_registry, registryAuthJson);
  mergeArgRegistryAuthJson(registryAuthJson);
  writeRegistryAuthJson(registryAuthJson, '/home/runner/.docker/config.json');

  const tags = collectTags(information);
  if (debug) {
    console.log('tags:', JSON.stringify(tags, null, 2));
  }

  const destinations = prepareDestinations(targetRegistries, tags);
  if (debug) {
    console.log('destinations:', JSON.stringify(destinations, null, 2));
  }

  const dockerArgs = prepareDockerArgs(destinations);
  if (debug) {
    console.log('dockerArgs:', JSON.stringify(dockerArgs, null, 2));
  }

  executeDockerBuild(dockerArgs, destinations);
}
catch (error) {
  console.log('Failed to build docker image', error);
  core.setFailed(error.message);
  process.exit(1);
}
