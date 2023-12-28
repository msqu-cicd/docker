import * as core from '@actions/core';
import * as github from '@actions/github';
import * as action_information from 'information';
import {
  addCiRegistryAuth,
  collectTags,
  determineDockerConfigFileLocation,
  executeDockerBuild,
  isTrueString,
  mergeArgRegistryAuthJson,
  mergeExistingDockerAuthJson,
  prepareDestinations,
  prepareDockerArgs,
  processAdditionalRegistries,
  writeRegistryAuthJson
} from './lib';


try {
  if (isTrueString(core.getBooleanInput('debug_log_github_context'))) {
    console.log(JSON.stringify(github.context, null, 2));
  }

  const information = action_information.collect_all(true, false);

  const debug = isTrueString(process.env['ACTIONS_STEP_DEBUG']);

  let targetRepos = [];
  const repoStr   = github.context.repo.owner + '/' + github.context.repo.repo;

  let ci_registry = false;
  if (core.getBooleanInput('add_ci_registry_target')) {
    ci_registry            = information.ci_hostname;
    const ci_registry_repo = ci_registry + '/' + repoStr + ':';
    targetRepos.push(ci_registry_repo);
  }

  processAdditionalRegistries(targetRepos);

  const dockerConfigFile = determineDockerConfigFileLocation(core.getInput('docker_auth_json_file'));
  if (debug) {
    console.log('determined .docker/config.json location: ', dockerConfigFile);
  }

  const registryAuthJson = {auths: {}};
  mergeExistingDockerAuthJson(registryAuthJson);
  addCiRegistryAuth(ci_registry, registryAuthJson);
  mergeArgRegistryAuthJson(registryAuthJson);
  writeRegistryAuthJson(registryAuthJson, dockerConfigFile);

  const tags = collectTags(information);
  if (debug) {
    console.log('tags:', JSON.stringify(tags, null, 2));
  }

  const destinations = prepareDestinations(targetRepos, tags);
  if (debug || core.getBooleanInput('debug_log_destinations')) {
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
