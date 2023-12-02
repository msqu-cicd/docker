import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import {Base64} from 'js-base64';

export function processAdditionalRegistries(targetRegistries) {
  const additionalRegistries = core.getInput('additional_registries');
  if (additionalRegistries != null && additionalRegistries.length > 0) {
    const additionalRegistriesArr = additionalRegistries.split(',');
    for (let registry of additionalRegistriesArr) {
      registry = registry.trim();
      if (!registry.endsWith(':')) {
        registry += ':';
      }
      targetRegistries.push(registry);
    }
  }
}

function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

export function addCiRegistryAuth(ci_registry, registryAuthJson) {
  if (!core.getBooleanInput('add_ci_registry_auth')) {
    return;
  }

  if (ci_registry === false || ci_registry.length <= 0) {
    console.log(
      'WARNING: add_ci_registry_auth enabled but ci_registry is not set'
    );
    return;
  }

  const argCiRegistryPassword = (core.getInput('ci_registry_password') ?? '').trim();
  if (argCiRegistryPassword == null || argCiRegistryPassword.length <= 0) {
    console.log('WARNING: add_ci_registry_auth enabled but ci_registry_password env is empty');
    return;
  }

  registryAuthJson.auths[ci_registry] = Base64.encode('token:' + argCiRegistryPassword);
}

export function mergeArgRegistryAuthJson(registryAuthJson) {
  const argRegistryAuthJson = process.env['REGISTRY_AUTH_JSON'];
  if (argRegistryAuthJson != null && argRegistryAuthJson.trim().length > 0) {
    try {
      const argRegistryAuth = JSON.parse(argRegistryAuthJson);
      if (argRegistryAuth.auth != null) {
        for (const key in argRegistryAuth.auth) {
          if (argRegistryAuth.auth.hasOwnProperty(key)) {
            registryAuthJson[key] = argRegistryAuth.auth[key];
          }
        }
      }
    }
    catch (e) {
      console.log('Failed to parse registry auth json', e);
      core.setFailed(error.message);
      process.exit(1);
    }
  }
}

export function writeRegistryAuthJson(registryAuthJson, path) {
  fs.writeFileSync(path, JSON.stringify(registryAuthJson, null, 2));
}

export function collectTags() {
  const tags          = [];
  let foundSemverTag  = false;
  let tagPrefix       = (core.getInput('tag_prefix') ?? '').trim();
  let tagSuffix       = (core.getInput('tag_suffix') ?? '').trim();
  let tagCommitPrefix = (core.getInput('tag_suffix') ?? '').trim();

  // handle semver
  if (
    core.getBooleanInput('tag_semver_major') &&
    information.semver_major != null
  ) {
    tags.push(tagPrefix + information.semver_major);
    foundSemverTag = true;
  }
  if (
    core.getBooleanInput('tag_semver_minor') &&
    information.semver_minor != null
  ) {
    tags.push(tagPrefix + information.semver_minor);
    foundSemverTag = true;
  }
  if (
    core.getBooleanInput('tag_semver_patch') &&
    information.semver_patch != null
  ) {
    tags.push(tagPrefix + information.semver_patch);
    foundSemverTag = true;
  }

  // handle git tag/branch
  if (
    core.getBooleanInput('tag_ref_normalized_enable') &&
    foundSemverTag === false
  ) {
    if (information.git_tag != null) {
      // TODO normalize tag from git for docker
      tags.push(tagPrefix + information.git_tag + tagSuffix);
    }
    if (information.git_current_branch != null) {
      // TODO normalize branch from git for docker
      tags.push(tagPrefix + information.git_current_branch + tagSuffix);
    }
  }

  // handle commit sha
  if (core.getBooleanInput('tag_commit_enable')) {
    tags.push(tagPrefix + tagCommitPrefix + github.context.sha + tagSuffix);
  }

  return tags;
}

export function prepareDestinations(registries, tags) {
  const destinations = [];
  registries.forEach((registry) => {
    tags.forEach((tag) => {
      destinations.push(registry + tag);
    });
  });

  return destinations;
}
