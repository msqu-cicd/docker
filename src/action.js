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

const information = action_information.collect_all(true, false);
const debug       = !!core.getInput('debug');

let targetRegistries = [];
const repoStr        = github.context.repo.owner + '/' + github.context.repo.repo;

if (core.getBooleanInput('add_ci_registry_target')) {
  const ci_registry = information.ci_hostname + '/' + repoStr;
  targetRegistries.push(ci_registry);
}
else {
  const ci_registry = false;
}

processAdditionalRegistries();
const registryAuthJson = {auths: {}};
addCiRegistryAuth(registryAuthJson);
mergeArgRegistryAuthJson(registryAuthJson);
writeRegistryAuthJson(registryAuthJson, '/home/runner/.docker/config.json');

const tags = collectTags();
if (debug) {
  console.log('tags:', JSON.stringify(tags, null, 2));
}

const destinations = prepareDestinations(targetRegistries, tags);
if (debug) {
  console.log('destinations:', JSON.stringify(tags, null, 2));
}
