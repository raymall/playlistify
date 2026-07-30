// Fails fast before local development or a production build uses an
// unsupported Node runtime. `.nvmrc` and package engines document the contract,
// but neither automatically switches an already-open shell.

const REQUIRED_NODE_MAJOR = 24
const currentVersion = process.versions.node
const currentMajor = Number.parseInt(currentVersion.split('.')[0] ?? '', 10)

if (currentMajor !== REQUIRED_NODE_MAJOR) {
  console.error(
    `Playlistify requires Node ${REQUIRED_NODE_MAJOR}.x; current runtime is ${currentVersion}. Run "nvm use" and try again.`,
  )
  process.exit(1)
}

console.log(`Node runtime OK: ${currentVersion}`)
