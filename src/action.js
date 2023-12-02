import * as core from '@actions/core';
import * as github from '@actions/github';
import * as action_information from 'information';
import {
  addCiRegistryAuth,
  collectTags,
  mergeArgRegistryAuthJson,
  prepareDestinations,
  processAdditionalRegistries,
  writeRegistryAuthJson
} from './lib';


try {
  const information = action_information.collect_all(true, false);
  const debug       = !!core.getInput('debug');

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

  const tags = collectTags();
  if (debug) {
    console.log('tags:', JSON.stringify(tags, null, 2));
  }

  const destinations = prepareDestinations(targetRegistries, tags);
  if (debug) {
    console.log('destinations:', JSON.stringify(destinations, null, 2));
  }
}
catch (error) {
  console.log('Failed to build docker image', e);
  core.setFailed(error.message);
  process.exit(1);
}
