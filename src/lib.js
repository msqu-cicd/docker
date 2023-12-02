import * as core from '@actions/core';
import * as github from '@actions/github';
import * as child_process from 'child_process';
import * as fs from 'fs';
import {Base64} from 'js-base64';
import * as path from 'path';

export function processAdditionalRegistries(targetRegistries) {
  const additionalRegistries = core.getInput('additional_registries');
  if (additionalRegistries != null && additionalRegistries.length > 0) {
    const additionalRegistriesArr = additionalRegistries.split(',');
    for (let registry of additionalRegistriesArr) {
      registry = registry.trim();
      if (!registry.contains(':')) {
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
    console.log('WARNING: add_ci_registry_auth enabled but ci_registry is not set');
    return;
  }

  const argCiRegistryPassword = (core.getInput('ci_registry_password') ?? '').trim();
  if (argCiRegistryPassword == null || argCiRegistryPassword.length <= 0) {
    console.log('WARNING: add_ci_registry_auth enabled but ci_registry_password env is empty');
    return;
  }

  registryAuthJson.auths[ci_registry] = {'auth': Base64.encode('token:' + argCiRegistryPassword)};
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
    catch (error) {
      console.log('Failed to parse registry auth json', error);
      core.setFailed(error.message);
      process.exit(1);
    }
  }
}

export function writeRegistryAuthJson(registryAuthJson, targetFile) {
  fs.mkdirSync(path.dirname(targetFile), {recursive: true});
  fs.writeFileSync(targetFile, JSON.stringify(registryAuthJson, null, 2));
}

function isNonEmptyStr(str) {
  return str != null && str !== 'false' && str.length > 0;
}

export function collectTags(information) {
  const tags          = [];
  let foundSemverTag  = false;
  let tagPrefix       = (core.getInput('tag_prefix') ?? '').trim();
  let tagSuffix       = (core.getInput('tag_suffix') ?? '').trim();
  let tagCommitPrefix = (core.getInput('tag_commit_prefix') ?? '').trim();

  // handle semver
  if (core.getBooleanInput('tag_semver_major') && isNonEmptyStr(information.semver_major)) {
    tags.push(tagPrefix + information.semver_major);
    foundSemverTag = true;
  }
  if (core.getBooleanInput('tag_semver_minor') && isNonEmptyStr(information.semver_minor)) {
    tags.push(tagPrefix + information.semver_minor);
    foundSemverTag = true;
  }
  if (core.getBooleanInput('tag_semver_patch') && isNonEmptyStr(information.semver_patch)) {
    tags.push(tagPrefix + information.semver_patch);
    foundSemverTag = true;
  }

  // handle git tag/branch
  if (core.getBooleanInput('tag_ref_normalized_enable') && foundSemverTag === false) {
    if (isNonEmptyStr(information.git_tag)) {
      // TODO normalize tag from git for docker
      tags.push(tagPrefix + information.git_tag + tagSuffix);
    }
    if (isNonEmptyStr(information.git_current_branch)) {
      // TODO normalize branch from git for docker
      tags.push(tagPrefix + information.git_current_branch + tagSuffix);
    }
  }

  // handle commit sha
  if (core.getBooleanInput('tag_commit_enable') && isNonEmptyStr(github.context.sha)) {
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

export function getDockerContextDir() {
  if (isNonEmptyStr(core.getInput('docker_context_dir'))) {
    return core.getInput('docker_context_dir');
  }
  else {
    return process.env['GITHUB_WORKSPACE'];
  }
}

export function prepareDockerArgs(destinations) {
  let dockerArgs = (core.getInput('docker_args') ?? '').trim();
  if (dockerArgs.length > 0) {
    dockerArgs = [dockerArgs];
  }
  else {
    dockerArgs = [];
  }

  if (isNonEmptyStr(core.getInput('dockerfile'))) {
    dockerArgs.unshift('--file ' + core.getInput('dockerfile'));
  }

  dockerArgs.unshift(getDockerContextDir());

  if (isNonEmptyStr(core.getInput('docker_multiarch'))) {
    if (!core.getBooleanInput('use_buildx')) {
      throw new Error('Unsupported configuration: Cannot build multiarch without enabling buildx');
    }
    let archList = (core.getInput('docker_multiarch'));
    if (archList === 'true' || archList === '1') {
      archList = 'linux/amd64,linux/arm64';
    }
    if (archList.length > 0) {
      dockerArgs.push('--platform ' + archList);
    }
  }

  if (core.getBooleanInput('squash_layers')) {
    dockerArgs.push('--squash');
  }

  destinations.forEach(dest => {
    dockerArgs.push('--tag ' + dest);
  });

  if (isNonEmptyStr(core.getInput('additional_registry_destinations'))) {
    dockerArgs.push(core.getInput('additional_registry_destinations'));
  }

  return dockerArgs;
}

export function executeDockerBuild(dockerArgs, destinations) {
  const dockerArgsStr = dockerArgs.join(' ');
  const isBuildX      = core.getBooleanInput('use_buildx');
  let dockerSubCmd    = isBuildX ? 'buildx build' : 'build';
  if (core.getBooleanInput('docker_push')) {
    dockerSubCmd += ' --push';
  }
  const execStr = `docker ${dockerSubCmd} ${dockerArgsStr}`;
  console.log(`executing: ${execStr}`);

  const proc = child_process.spawnSync(execStr, {
    shell: true,
    stdio: 'inherit',
    cwd  : getDockerContextDir()
  });

  // push for legacy builder
  // if (!isBuildX && core.getBooleanInput('docker_push')) {
  //   destinations.forEach(dst => {
  //     const pushProc = child_process.spawnSync('docker push ' + dst, {
  //       shell: true,
  //       stdio: 'inherit',
  //       cwd  : getDockerContextDir()
  //     });
  //     if (pushProc.status != null && pushProc.status > 0) {
  //       throw new Error('docker push ' + dst + ' failed');
  //     }
  //   });
  // }

  if (proc.status != null && proc.status > 0) {
    throw new Error('docker build failed');
  }

  if (proc.error != null) {
    throw proc.error;
  }
}
