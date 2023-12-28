import * as core from '@actions/core';
import * as github from '@actions/github';
import * as child_process from 'child_process';
import * as fs from 'fs';
import {Base64} from 'js-base64';
import * as os from 'os';
import * as path from 'path';

export function processAdditionalRegistries(targetRegistries) {
  const additionalRegistries = core.getInput('additional_registries');
  if (additionalRegistries != null && additionalRegistries.length > 0) {
    const additionalRegistriesArr = additionalRegistries.split(',');
    for (let registry of additionalRegistriesArr) {
      registry = registry.trim();
      if (!registry.includes(':')) {
        registry += ':';
      }
      targetRegistries.push(registry);
    }
  }
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
  const argRegistryAuthJson = core.getInput('registry_auth_json');
  if (argRegistryAuthJson != null && argRegistryAuthJson.trim().length > 0) {
    try {
      const argRegistryAuth = JSON.parse(argRegistryAuthJson);
      if (argRegistryAuth.auths != null) {
        for (const key in argRegistryAuth.auths) {
          if (argRegistryAuth.auths.hasOwnProperty(key)) {
            registryAuthJson.auths[key] = argRegistryAuth.auths[key];
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

export function mergeExistingDockerAuthJson(registryAuthJson, targetFile) {
  if (!core.getBooleanInput('merge_existing_auth_json')) {
    console.log('merge_existing_auth_json is disabled');
    return;
  }

  if (!fs.existsSync(targetFile)) {
    console.log(`${targetFile} does not exist`);
    return;
  }

  try {
    const existingJsonStr = fs.readFileSync(targetFile, {encoding: 'utf-8'});
    const existingJson    = JSON.parse(existingJsonStr);

    if (existingJson.auths != null && typeof existingJson.auths === 'object') {
      for (const key in existingJson.auths) {
        console.log(`existingJson.auths.${key}`);
        if (existingJson.auths.hasOwnProperty(key)) {
          console.log(`existingJson.auths.${key} has own property, assigning value`);
          registryAuthJson.auths[key] = existingJson.auths[key];
        }
      }
    }
    else {
      console.log('existingJson.auths is ' + typeof existingJson.auths);
    }
  }
  catch (e) {
    console.log(`Failed to parse existing docker auth json in file: ${targetFile}"`);
    core.setFailed(`Failed to parse existing docker auth json in file: ${targetFile}"` + e.message);
    process.exit(1);
  }
}

export function writeRegistryAuthJson(registryAuthJson, targetFile) {
  fs.mkdirSync(path.dirname(targetFile), {recursive: true});
  const jsonContents = JSON.stringify(registryAuthJson, null, 2);

  // create and log a censored copy if enabled
  if (core.getBooleanInput('debug_log_auth_json')) {
    const copy = JSON.parse(jsonContents);
    for (const registry in copy.auths) {
      if (copy.auths.hasOwnProperty(registry)) {
        let credentials = copy.auths[registry].auth;
        if (credentials != null) {
          // truncate credentials to avoid leaking sensitive information
          if (credentials.length > 16) {
            credentials = credentials.substr(0, 16) + '...';
          }
          else {
            credentials = '***censored***';
          }
          copy.auths[registry].auth = credentials;
        }
      }
    }
    console.log('debug_log_auth_json:', copy);
  }

  fs.writeFileSync(targetFile, jsonContents);
}

function isNonEmptyStr(str) {
  return str != null && str !== 'false' && str.length > 0;
}

export function collectTags(information) {
  const tags                = [];
  let mostSpecificSemverTag = false;
  let tagPrefix             = (core.getInput('tag_prefix') ?? '').trim();
  let tagSuffix             = (core.getInput('tag_suffix') ?? '').trim();
  let tagCommitPrefix       = (core.getInput('tag_commit_prefix') ?? '').trim();


  // tag semver
  if (core.getBooleanInput('tag_semver_enable') && information.semver_valid) {
    if (core.getBooleanInput('tag_semver_major') && information.semver_major != null) {
      mostSpecificSemverTag = tagPrefix + information.semver_major;
      tags.push(mostSpecificSemverTag);

      if (core.getBooleanInput('tag_semver_minor') && information.semver_minor != null) {
        mostSpecificSemverTag += '.' + information.semver_minor;
        tags.push(mostSpecificSemverTag);

        if (core.getBooleanInput('tag_semver_patch') && information.semver_patch != null) {
          mostSpecificSemverTag += '.' + information.semver_patch;
          tags.push(mostSpecificSemverTag);
        }
      }
    }
  }

  // handle git tag/branch
  if (core.getBooleanInput('tag_ref_normalized_enable')) {
    // only apply tag IF it doesn't match the semver
    if (isNonEmptyStr(information.git_tag)) {
      const normalizedTag = tagPrefix + normalizeGitRefForDockerTag(information.git_tag) + tagSuffix;
      if (mostSpecificSemverTag !== normalizedTag) {
        tags.push(normalizedTag);
      }
    }
    if (isNonEmptyStr(information.git_current_branch)) {
      const normalizedBranch = tagPrefix + normalizeGitRefForDockerTag(information.git_current_branch) + tagSuffix;
      if (mostSpecificSemverTag !== normalizedBranch) {
        tags.push(normalizedBranch);
      }
    }
  }

  // handle additional tags
  core.getInput('tags_additional')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .forEach(t => {
        tags.push(t);
      });

  // handle commit sha
  if (core.getBooleanInput('tag_commit_enable') && isNonEmptyStr(github.context.sha)) {
    tags.push(tagPrefix + tagCommitPrefix + github.context.sha + tagSuffix);
  }

  return tags;
}

export function normalizeGitRefForDockerTag(ref) {
  return ref
    .replaceAll('/', '-');
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
  let contextDir = core.getInput('docker_context_dir');
  if (!isNonEmptyStr(core.getInput('docker_context_dir'))) {
    return process.env['GITHUB_WORKSPACE'];
  }
  if (!contextDir.startsWith('/')) {
    contextDir = process.env['GITHUB_WORKSPACE'] + '/' + contextDir;
  }
  return contextDir;
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

  if (isNonEmptyStr(core.getInput('additional_destinations'))) {
    core.getInput('additional_destinations')
        .split(',')
        .map(s => s.trim())
        .forEach(dst => {
          dockerArgs.push('--tag ' + dst);
        });
  }

  if (isNonEmptyStr(core.getInput('build_args'))) {
    let buildArgs = core.getInput('build_args')
                        .split('\n')
                        .map(s => s.trim())
                        .map(s => {
                          const equalIndex = s.indexOf('=');
                          const key        = s.substring(0, equalIndex);
                          const value      = s.substring(equalIndex + 1);
                          return {
                            key,
                            value
                          };
                        });

    console.log('parsed build_args as: ', JSON.stringify(buildArgs, null, 2));
    buildArgs.forEach(arg => {
      dockerArgs.push(`--build-arg ${arg.key}="${arg.value}"`);
    });
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
  if (core.getBooleanInput('docker_pull')) {
    dockerSubCmd += ' --pull';
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

export function determineDockerConfigFileLocation(path) {
  if (path == null || !path.length) {
    return os.homedir + '/.docker/config.json';
  }

  // absolute path
  if (path.startsWith('/')) {
    return path;
  }

  // relative path to home dir
  return os.homedir + '/' + path;
}

export function isTrueString(str) {
  return str === '1'
    || str === 'true'
    || str === 'True'
    || str === 'TRUE';
}
