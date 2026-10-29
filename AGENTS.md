# AGENT.md

Guidance for AI coding agents working in this repository.

## What this is

`smartbed-mqtt` is a Home Assistant add-on, written in Node.js/TypeScript, that controls adjustable smart beds. It talks to each bed (via a cloud API, local TCP/HTTP/UDP, or BLE through an ESPHome Bluetooth proxy). It then exposes the bed to Home Assistant as MQTT-discovery entities: buttons, switches, covers, sensors, selects, lights, and number sliders.

This is **Tony Apuzzo's fork** ("TAF") of Richard Hopton's original add-on, which is no longer maintained. Keep fork-specific metadata (names, URLs, maintainer) pointing at `TonyApuzzo/smartbed-mqtt`, not upstream. The maintainer only has a physical **MotoSleep** bed. Other bed types are untested in the wild, so be conservative when changing their protocol code.

## Commands

| Task | Command |
| --- | --- |
| Install deps | `yarn install` (Yarn 1, Node 24; see `.nvmrc`) |
| Build | `yarn build` (`tsc -p tsconfig.build.json && tsc-alias` → `dist/tsc/`) |
| Clean build (CI) | `yarn build:ci` |
| Tests (once) | `yarn test:ci` |
| Tests (watch) | `yarn test` |
| Lint | `yarn lint` (zero warnings allowed) |
| Format | `yarn prettier` |
| Run locally | `yarn start` (ts-node). Needs `../data/options.json` relative to the cwd and `MQTTHOST`/`MQTTPORT`/`MQTTUSER`/`MQTTPASSWORD` env vars |
| Docker dev | `yarn docker:dev` (mounts `../data` as `/data`) |

The pre-commit hook runs `lint-staged` (eslint). CI (`.github/workflows/build-test.yml`) runs build and tests on PRs to `main`. A push to `main` builds and pushes a Docker image to GHCR.

## Runtime / deployment

- `Dockerfile`: multi-stage build. The runtime image contains bashio, `run.sh`, `node_modules` and the compiled JS.
- `run.sh` (bashio) reads add-on options, auto-detects MQTT settings from the Supervisor, exports `MQTT*` env vars, then runs `node index.js`.
- Options are read at module load time from `../data/options.json` (`src/Utils/options.ts`). In the container this is `/data/options.json`.
- `config.json` is the HA add-on manifest: default `options` plus the `schema`. **Any new user option must be added to both `options` and `schema` here**, and documented in `README.md`.
- `repository.json` is the HA add-on repository manifest.
- The process is a long-running daemon. If it exits, HA does not restart it unless the add-on's Watchdog is enabled **and** the exit code is non-zero. Don't swallow fatal errors into a zero exit code, and don't let recoverable network errors become fatal (see below).

## Versioning / release

The version appears in several places and should be bumped together:
- `package.json` → `version`
- `config.json` → `version`. **HA uses this to detect updates**, so a fix does not reach users until it changes.
- `Dockerfile` → `io.hass.version` label
- `CHANGELOG.md` → new `## vX.Y.Z` section at the top. Use the `(Area) description` bullet style.

## Source layout (`src/`)

- `index.ts`: entry point. Loads strings, connects to MQTT, then dispatches on `options.type`. Cloud and IP types go first. BLE types also connect to ESPHome. Process-level signal and exception handlers live here.
- `MQTT/`: wraps the `mqtt` client (`MQTTConnection` re-emits each message as an event named after its topic). `IMQTTConnection` is the interface entities depend on.
- `ESPHome/`: ESPHome native API connection(s) to BLE proxies (`@2colors/esphome-native-api`).
  - `connect.ts` handles the initial connect and authorization.
  - `ESPConnection` handles BLE discovery.
  - `types/BLEDevice.ts` wraps a single BLE peripheral (connect, GATT read/write/notify).
  - The library reconnects by itself after the socket closes, as long as an `error` listener is attached. Without one, a socket error such as `ECONNRESET` becomes an uncaught exception.
- `BLE/`: `BLEController`, the generic `IController` for BLE beds. It handles command writes, repeat timers, notify subscriptions, and auto-disconnect after 60s unless `stayConnected`.
- `Common/`: shared builders (`buildCommandButton`, `buildCommandSwitch`, `buildRepeatingCommandSwitch`, `buildEntityConfig`, `buildMQTTDeviceData`) and the `IController`/`IEventSource` interfaces.
- `HomeAssistant/`: MQTT-discovery entity classes (`Button`, `Switch`, `Cover`, `PositionalCover`, `Sensor`, `JsonSensor`, `Select`, `NumberSlider`, `Light`, `BinarySensor`). They extend `base/Entity` / `base/StatefulEntity`.
- `Strings/en.ts`: display names for entities. Keys are typed as `StringsKey` and looked up with `getString()`. Add a key here when adding an entity.
- `Utils/`: small helpers (logger, timers, byte/hex conversion, `Deferred`, `buildDictionary`, `safeId`, …).
- One folder per bed brand: `Sleeptracker`, `ErgoWifi`, `ErgoMotion`, `Logicdata`, `Richmat`, `Linak`, `Solace`, `MotoSleep`, `Reverie`, `LeggettPlatt`, `Okimat`, `Keeson`, `Octo`, plus `Scanner` (a BLE discovery helper). The usual shape is:
  - `<brand>.ts`: entry point `(mqtt, esphome?) => Promise<void>`. It finds the configured devices, builds a controller, and sets up entities.
  - `options.ts`: reads this brand's device list from options.
  - `Commands.ts` / `CommandBuilder.ts`: the byte protocol.
  - `setup*Entities.ts` / `setup*Buttons.ts`: entity wiring.

### Adding a new bed type

1. Create `src/<Brand>/` following an existing BLE brand (MotoSleep is the simplest).
2. Add the type to the `Type` union in `src/Utils/options.ts` and to the dispatch `switch` in `src/index.ts`.
3. Add `<brand>Devices` to `config.json` `options` and `schema`, and add the type to the `type` list in `schema`.
4. Add any new entity names to `Strings/en.ts`.
5. Document it in `README.md`.

## Conventions

- TypeScript `strict`, CommonJS output, ES2021 target. Path aliases: `@ha/*` → `HomeAssistant/*`, `@mqtt/*` → `MQTT/*`, `@utils/*` → `Utils/*`. Other modules are imported relative to `src/` (e.g. `'ESPHome/IESPConnection'`) via `baseUrl`. `tsc-alias` rewrites these at build time.
- Prettier: single quotes, 2 spaces, 120 columns, `es5` trailing commas.
- Prefer arrow-function class members (`writeCommand = async () => …`) and `const` arrow exports, as used throughout.
- Log through `@utils/logger` (`logInfo`/`logWarn`/`logError`) with a `[Area]` prefix, e.g. `'[ESPHome] Connected:'`.
- ESLint warns on floating promises. When intentionally fire-and-forgetting, use `void` **and** make sure the promise cannot reject unhandled (add a `.catch`). An unhandled rejection crashes the process.
- Errors from user-triggered commands are caught and logged in the entity/command builders. Keep them that way so a bad command never takes down the add-on.
- Tests are Jest + ts-jest, colocated as `*.test.ts` (mostly `HomeAssistant/` and `Utils/`). `Utils/testHelpers.ts` and `jest-mock-extended` are used for mocking MQTT.

## Gotchas

- `package.json` declares `"type": "module"`, but `tsc` emits CommonJS. The Docker image works only because the runtime stage copies `dist/tsc` without `package.json`. Running `dist/tsc/*.js` directly from the repo fails with `exports is not defined in ES module scope`.
- `src/Utils/options.ts` reads `../data/options.json` **at import time**, so importing almost anything requires that file to exist. Tests that touch option-reading modules need to mock it.
- Most ESPHome BLE proxies allow only one API client. The proxy must not also be adopted by Home Assistant.
- BLE beds often accept only one connection. `stayConnected` trades app/remote access for responsiveness.
- `MQTTConnection` uses topic names as event names (`setMaxListeners(0)`), so each entity subscribes with `mqtt.on(topic, …)`.
