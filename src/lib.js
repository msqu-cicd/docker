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
      if (registry.length <= 0) {
        continue;
      }
      // only treat a ':' after the last '/' as a tag separator, so a registry
      // with a port (registry:5000/owner/repo) still gets one appended
      const lastSegment = registry.substring(registry.lastIndexOf('/') + 1);
      if (!lastSegment.includes(':')) {
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
    return;
  }

  if (!fs.existsSync(targetFile)) {
    console.log(`no pre-existing config found, skipping merge: ${targetFile}`);
    return;
  }

  try {
    const existingJsonStr = fs.readFileSync(targetFile, {encoding: 'utf-8'});
    const existingJson    = JSON.parse(existingJsonStr);

    if (existingJson.auths != null && typeof existingJson.auths === 'object') {
      for (const key in existingJson.auths) {
        if (existingJson.auths.hasOwnProperty(key)) {
          console.log(`merging existingJson.auths[${key}]`);
          registryAuthJson.auths[key] = existingJson.auths[key];
        }
      }
    }
  }
  catch (e) {
    console.log(`Failed to parse existing docker auth json in file: ${targetFile}"`);
    core.setFailed(`Failed to parse existing docker auth json in file: ${targetFile}"` + e.message);
    process.exit(1);
  }
}

export function writeRegistryAuthJson(registryAuthJson, targetFile) {
  fs.mkdirSync(path.dirname(targetFile), {recursive: true, mode: 0o700});
  const jsonContents = JSON.stringify(registryAuthJson, null, 2);

  // create and log a censored copy if enabled
  if (core.getBooleanInput('debug_log_auth_json')) {
    const copy = JSON.parse(jsonContents);
    for (const registry in copy.auths) {
      if (copy.auths.hasOwnProperty(registry)) {
        // censor every credential field completely
        for (const field in copy.auths[registry]) {
          if (copy.auths[registry].hasOwnProperty(field)) {
            copy.auths[registry][field] = '***censored***';
          }
        }
      }
    }
    console.log('debug_log_auth_json:', copy);
  }

  fs.writeFileSync(targetFile, jsonContents, {mode: 0o600});
  fs.chmodSync(targetFile, 0o600);
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
  let semverVersion = false;
  if (core.getBooleanInput('tag_semver_enable') && information.semver_valid) {
    if (core.getBooleanInput('tag_semver_major') && information.semver_major != null) {
      semverVersion = '' + information.semver_major;
      tags.push(tagPrefix + semverVersion + tagSuffix);

      if (core.getBooleanInput('tag_semver_minor') && information.semver_minor != null) {
        semverVersion += '.' + information.semver_minor;
        tags.push(tagPrefix + semverVersion + tagSuffix);

        if (core.getBooleanInput('tag_semver_patch') && information.semver_patch != null) {
          semverVersion += '.' + information.semver_patch;
          tags.push(tagPrefix + semverVersion + tagSuffix);
        }
      }
    }
  }
  if (semverVersion !== false) {
    mostSpecificSemverTag = tagPrefix + semverVersion + tagSuffix;
  }

  // handle git tag/branch
  if (core.getBooleanInput('tag_ref_normalized_enable')) {
    // only apply tag IF it doesn't match the semver (a git tag "v1.2.3" matches semver "1.2.3")
    if (isNonEmptyStr(information.git_tag)) {
      const normalizedTag    = tagPrefix + normalizeGitRefForDockerTag(information.git_tag) + tagSuffix;
      const normalizedTagNoV = tagPrefix + normalizeGitRefForDockerTag(information.git_tag.replace(/^v/, '')) + tagSuffix;
      if (mostSpecificSemverTag !== normalizedTag && mostSpecificSemverTag !== normalizedTagNoV) {
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
  // docker tags may only contain [A-Za-z0-9_.-], must not start with '.' or '-'
  // and are limited to 128 characters
  return ref
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/^[.-]+/, '')
    .substring(0, 128);
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

export function collectAdditionalDestinations() {
  return (core.getInput('additional_destinations') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export function prepareDockerArgs(destinations) {
  // one argv element per entry; nothing here passes through a shell
  const dockerArgs = [getDockerContextDir()];

  if (isNonEmptyStr(core.getInput('dockerfile'))) {
    dockerArgs.push('--file', core.getInput('dockerfile'));
  }

  // extra user supplied arguments, split on any whitespace (newlines included);
  // quoting is not interpreted, one token becomes one argument
  (core.getInput('docker_args') ?? '')
    .split(/\s+/)
    .filter(s => s.length > 0)
    .forEach(arg => {
      dockerArgs.push(arg);
    });

  const multiarchInput = (core.getInput('docker_multiarch') ?? '').trim();
  const multiarchOff   = ['', 'false', 'False', 'FALSE', '0', 'no', 'No', 'NO'].includes(multiarchInput);
  if (!multiarchOff) {
    if (!core.getBooleanInput('use_buildx')) {
      throw new Error('Unsupported configuration: Cannot build multiarch without enabling buildx');
    }
    let archList = multiarchInput;
    if (isTrueString(archList)) {
      archList = 'linux/amd64,linux/arm64';
    }
    dockerArgs.push('--platform', archList);
  }

  // buildkit/buildx has no --squash support, only pass it to the legacy builder
  if (core.getBooleanInput('squash_layers') && !core.getBooleanInput('use_buildx')) {
    dockerArgs.push('--squash');
  }

  destinations.forEach(dest => {
    dockerArgs.push('--tag', dest);
  });

  collectAdditionalDestinations().forEach(dst => {
    dockerArgs.push('--tag', dst);
  });

  if (isNonEmptyStr(core.getInput('build_args'))) {
    core.getInput('build_args')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .forEach(s => {
          const equalIndex = s.indexOf('=');
          if (equalIndex <= 0) {
            console.log(`WARNING: ignoring build_args line without key=value format: ${s.substring(0, 64)}`);
            return;
          }
          console.log('adding build arg:', s.substring(0, equalIndex));
          dockerArgs.push('--build-arg', s);
        });
  }

  return dockerArgs;
}

export function executeDockerBuild(dockerArgs, destinations) {
  const isBuildX = core.getBooleanInput('use_buildx');
  const args     = isBuildX ? ['buildx', 'build'] : ['build'];
  if (core.getBooleanInput('docker_push')) {
    args.push('--push');
  }
  if (core.getBooleanInput('docker_pull')) {
    args.push('--pull');
  }
  args.push(...dockerArgs);

  // log the command with build-arg values masked
  const logArgs = args.map((arg, i) => {
    return i > 0 && args[i - 1] === '--build-arg' ? arg.replace(/=[\s\S]*/, '=***') : arg;
  });
  console.log('executing: docker ' + logArgs.join(' '));

  const proc = child_process.spawnSync('docker', args, {
    shell: false,
    stdio: 'inherit',
    cwd  : getDockerContextDir()
  });

  if (proc.error != null) {
    throw proc.error;
  }

  if (proc.signal != null) {
    throw new Error(`docker build was terminated by signal ${proc.signal}`);
  }

  if (proc.status !== 0) {
    throw new Error(`docker build failed with exit code ${proc.status}`);
  }
}

export function determineDockerConfigFileLocation(path) {
  if (path == null || !path.length) {
    return os.homedir() + '/.docker/config.json';
  }

  // absolute path
  if (path.startsWith('/')) {
    return path;
  }

  // relative path to home dir
  return os.homedir() + '/' + path;
}

export function isTrueString(str) {
  return str === '1'
    || str === 'true'
    || str === 'True'
    || str === 'TRUE';
}
