import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename, dirname } from 'node:path'
import { test } from 'node:test'

const bash = process.env.DEPLOY_TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
const remoteScript = resolve('.github/scripts/staging-release.sh')
const deployScript = resolve('.github/scripts/deploy-staging.sh')
const sha = 'a'.repeat(40)
const releaseId = `${sha}-123-1`
const stagingUrl = 'https://staging.example.test'
const posix = (path) => {
  const normalized = path.replaceAll('\\', '/')
  const temporaryPrefix = `${tmpdir().replaceAll('\\', '/')}/`
  if (process.platform === 'win32' && normalized.startsWith(temporaryPrefix)) {
    return `/tmp/${normalized.slice(temporaryPrefix.length)}`
  }
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
}

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'scrubshot-ci-'))
  const root = join(temporary, 'site')
  const bin = join(temporary, 'bin')
  const build = join(temporary, 'build')
  const archive = join(temporary, 'staging-dist.tar.gz')
  for (const path of [root, bin, join(build, 'models'), join(build, 'assets')]) mkdirSync(path, { recursive: true })
  const files = {
    'index.html': '<html>verified build</html>',
    'models/PP-OCRv5_mobile_det_infer.onnx': 'detection-model',
    'models/PP-OCRv5_mobile_rec_infer.onnx': 'recognition-model',
    'models/ppocr_keys_v5.txt': 'dictionary',
    'assets/runtime.wasm': 'runtime',
    'assets/index-hash.js': 'application',
    'assets/index-hash.css': 'styles',
  }
  for (const [path, contents] of Object.entries(files)) writeFileSync(join(build, path), contents)
  const env = {
    ...process.env,
    MSYS: 'winsymlinks:nativestrict',
    TEST_ROOT: posix(root),
    TEST_LOG: posix(join(temporary, 'commands.log')),
    TEST_LATEST: posix(join(temporary, 'latest')),
    TEST_HEALTH_FAILURE: '',
    TEST_UPLOAD_FAILURE: '',
    TEST_SUPERSEDE_UPLOAD: '',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/develop',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_STEP_SUMMARY: '',
    STAGING_HOST: 'staging.example.test',
    STAGING_PORT: '22',
    STAGING_USER: 'deploy',
    STAGING_ROOT: posix(root),
    STAGING_URL: stagingUrl,
    STAGING_SSH_KEY: 'test-placeholder-not-a-private-key',
    STAGING_KNOWN_HOSTS: 'test-placeholder-not-a-host-key',
  }
  writeFileSync(join(temporary, 'latest'), sha)

  function mock(name, content) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${content}\n`, { mode: 0o755 })
  }

  mock('curl', `
output=''
for argument in "$@"; do
  if [[ $output == next ]]; then output=$argument; break; fi
  if [[ $argument == --output ]]; then output=next; fi
done
request="\${!#}"
asset="\${request#https://staging.example.test/}"
asset="\${asset%%\\?*}"
printf 'health %s\\n' "$asset" >> "$TEST_LOG"
if [[ $TEST_HEALTH_FAILURE == true && $asset == *.onnx ]]; then
  printf '<html>wrong SPA response</html>' > "$output"
else
  cp "$TEST_ROOT/current/$asset" "$output"
fi`)
  mock('git', `printf '%s\\trefs/heads/develop\\n' "$(cat "$TEST_LATEST")"`)
  mock('ssh', `
printf 'ssh %s\\n' "\${!#}" >> "$TEST_LOG"
exec bash -c "\${!#}"`)
  mock('scp', `
printf 'upload\\n' >> "$TEST_LOG"
[[ $TEST_UPLOAD_FAILURE != true ]] || exit 1
destination="\${!#}"
arguments=("$@")
source="\${arguments[\${#arguments[@]}-2]}"
cp "$source" "\${destination#*:}"
if [[ $TEST_SUPERSEDE_UPLOAD == true ]]; then printf '%040d' 0 > "$TEST_LATEST"; fi`)
  if (process.platform === 'win32') mock('flock', 'exit 0')

  function run(script, args = [], extraEnv = {}) {
    const command = 'export PATH="$1:$PATH"; shift; exec bash "$@"'
    const result = spawnSync(bash, ['-c', command, 'test', posix(bin), posix(script), ...args], {
      env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000,
    })
    if (result.error) throw result.error
    return result
  }

  function shell(command) {
    const result = spawnSync(bash, ['-c', command], { env, encoding: 'utf8', timeout: 30000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }

  function packageBuild() {
    shell(`tar -czf '${posix(archive)}' -C '${posix(build)}' .`)
  }

  function prepare(previous = true) {
    const result = run(remoteScript, ['prepare', posix(root), releaseId, sha, stagingUrl])
    assert.equal(result.status, 0, result.stderr)
    packageBuild()
    shell(`cp '${posix(archive)}' "$TEST_ROOT/incoming/${releaseId}.tar.gz"`)
    if (previous) {
      mkdirSync(join(root, 'releases', 'previous'))
      writeFileSync(join(root, 'releases', 'previous', 'index.html'), 'old site')
      shell('ln -s "$TEST_ROOT/releases/previous" "$TEST_ROOT/current"')
      const target = shell('readlink -f "$TEST_ROOT/current"')
      assert.equal(target, `${posix(root)}/releases/previous`)
    }
  }

  return {
    root, build, archive, run, shell, packageBuild, prepare,
    publish: (extraEnv = {}) => run(remoteScript, ['publish', posix(root), releaseId, sha, stagingUrl], extraEnv),
    deploy: (extraEnv = {}) => run(deployScript, [posix(archive)], extraEnv),
    log: () => existsSync(join(temporary, 'commands.log')) ? readFileSync(join(temporary, 'commands.log'), 'utf8') : '',
    setLatest: (value) => writeFileSync(join(temporary, 'latest'), value),
    cleanup: () => {
      assert.equal(dirname(temporary), tmpdir())
      assert.ok(basename(temporary).startsWith('scrubshot-ci-'))
      rmSync(temporary, { recursive: true, force: true })
    },
  }
}

function scenario(name, verify) {
  test(name, () => {
    const context = fixture()
    try { verify(context) } finally { context.cleanup() }
  })
}

scenario('publishes an immutable release and verifies every runtime resource', (context) => {
  context.prepare()
  const result = context.publish()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(realpathSync(join(context.root, 'current')), realpathSync(join(context.root, 'releases', releaseId)))
  assert.equal(readFileSync(join(context.root, 'current', 'scrubshot-release.txt'), 'utf8'), `${sha}\n`)
  assert.ok(existsSync(join(context.root, 'releases', 'previous', 'index.html')))
  assert.match(context.log(), /health assets\/runtime.wasm/)
  assert.match(context.log(), /health models\/PP-OCRv5_mobile_rec_infer.onnx/)
  assert.match(context.log(), /health assets\/index-hash.js/)
  assert.equal(existsSync(join(context.root, 'incoming', `${releaseId}.tar.gz`)), false)
})

scenario('supports a first deployment without a previous release', (context) => {
  context.prepare(false)
  const result = context.publish()
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(context.root, 'current', 'index.html')))
})

scenario('rolls back when a model URL returns HTML with HTTP 200', (context) => {
  context.prepare()
  const result = context.publish({ TEST_HEALTH_FAILURE: 'true' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /content mismatch/)
  assert.equal(readFileSync(join(context.root, 'current', 'index.html'), 'utf8'), 'old site')
})

scenario('removes the activation link if the first deployment is unhealthy', (context) => {
  context.prepare(false)
  const result = context.publish({ TEST_HEALTH_FAILURE: 'true' })
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(join(context.root, 'current')), false)
})

scenario('does not switch the site when the build is missing WASM', (context) => {
  rmSync(join(context.build, 'assets', 'runtime.wasm'))
  context.prepare()
  const result = context.publish()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing runtime WASM/)
  assert.equal(readFileSync(join(context.root, 'current', 'index.html'), 'utf8'), 'old site')
})

scenario('rejects symlinks inside an archive before extraction', (context) => {
  context.shell(`ln -s /etc/passwd '${posix(context.build)}/escape'`)
  context.prepare()
  const result = context.publish()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /only contain regular files/)
  assert.equal(readFileSync(join(context.root, 'current', 'index.html'), 'utf8'), 'old site')
})

scenario('refuses to replace an existing current directory', (context) => {
  context.prepare(false)
  mkdirSync(join(context.root, 'current'))
  writeFileSync(join(context.root, 'current', 'index.html'), 'do not replace')
  const result = context.publish()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /current must be a symlink/)
  assert.equal(readFileSync(join(context.root, 'current', 'index.html'), 'utf8'), 'do not replace')
})

for (const [event, ref] of [
  ['pull_request', 'refs/heads/develop'],
  ['push', 'refs/heads/main'],
  ['push', 'refs/heads/feature/example'],
]) {
  scenario(`does not deploy ${event} on ${ref}`, (context) => {
    const result = context.deploy({ GITHUB_EVENT_NAME: event, GITHUB_REF: ref, STAGING_SSH_KEY: '' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(context.log(), '')
  })
}

scenario('fails explicitly when enabled deployment configuration is incomplete', (context) => {
  const result = context.deploy({ STAGING_HOST: '' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing configuration: STAGING_HOST/)
  assert.equal(context.log(), '')
})

scenario('rejects unsafe roots before connecting to SSH', (context) => {
  const result = context.deploy({ STAGING_ROOT: '/srv/staging/../production' })
  assert.notEqual(result.status, 0)
  assert.equal(context.log(), '')
})

scenario('skips a superseded commit without connecting to the server', (context) => {
  context.packageBuild()
  context.setLatest('b'.repeat(40))
  const result = context.deploy()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Skipping superseded/)
  assert.equal(context.log(), '')
})

scenario('discards an uploaded build superseded before activation', (context) => {
  context.packageBuild()
  const result = context.deploy({ TEST_SUPERSEDE_UPLOAD: 'true' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /superseded during upload/)
  assert.equal(existsSync(join(context.root, 'current')), false)
  assert.equal(existsSync(join(context.root, 'incoming', `${releaseId}.tar.gz`)), false)
  assert.doesNotMatch(context.log(), /bash -s -- publish/)
})

scenario('publishes the verified archive through SSH and SCP', (context) => {
  context.packageBuild()
  const result = context.deploy()
  assert.equal(result.status, 0, result.stderr)
  assert.match(context.log(), /upload/)
  assert.equal(readFileSync(join(context.root, 'current', 'scrubshot-release.txt'), 'utf8'), `${sha}\n`)
})

scenario('an upload failure leaves the current release untouched', (context) => {
  context.prepare()
  context.shell(`rm -f "$TEST_ROOT/incoming/${releaseId}.tar.gz"`)
  const result = context.deploy({ TEST_UPLOAD_FAILURE: 'true' })
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(join(context.root, 'current', 'index.html'), 'utf8'), 'old site')
  assert.doesNotMatch(context.log(), /bash -s -- publish/)
})
