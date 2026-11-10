# Voice chain: noise suppression and filters

The chain cleans up the voice on the speaker's machine. It runs in an
AudioWorklet between the microphone and the track that goes to WebRTC, before
SFrame encryption. Nothing leaves the machine and nothing comes from a CDN: the
worklet and the model are served by the site itself, with a hash in the name.

## The engine: GTCRN

Noise suppression uses **GTCRN**, a small neural network compiled to
WebAssembly. The binary comes from `@sapphi-red/web-noise-suppressor@0.4.1`
(MIT), pinned exactly. Only `gtcrn.wasm` is used. Our own worklet
(`processador-de-voz.ts`) calls the `.wasm` functions directly, without the
package's worklet or Emscripten glue.

### Candidates, measured here

Node 24 on Apple Silicon, synthetic test voice with noise at 5 dB SNR, each
engine alone. SNR by projection (conservative: voice distortion counts as
noise).

| Engine | SNR gain: white / pink / fan / keyboard | Delay | CPU per 128-sample block | `.wasm` | Licence |
|---|---|---|---|---|---|
| GTCRN (chosen) | +18.6 / +10.1 / +11.0 / +20.0 dB | 31.9 ms | 0.074 ms | 197 KB | MIT |
| RNNoise (same package) | +10.7 / +8.4 / +7.0 / +2.8 dB | 20.6 ms | 0.015 ms | 157 KB | BSD-3, Apache-2.0 |
| Speex preprocessor (same package) | did not suppress in this setup | 0 ms | 0.005 ms | 56 KB | BSD |
| DeepFilterNet 3 | not measured | | | | Excluded: downloads its model from a CDN |
| Browser native (`noiseSuppression`) | see the comparison below | | | 0 | |

Why GTCRN: better than RNNoise on every noise measured, and much better on
keyboard clicks. About 3 % of one core. 197 KB (116 KB gzipped), loaded only
when the first chain starts. MIT licence. Runs in Chromium, Firefox, WebKit and
Electron, as long as the CSP allows WebAssembly. The cost is 31.9 ms of delay,
against 20.6 ms for RNNoise.

Sources: https://github.com/Xiaobin-Rong/gtcrn,
https://github.com/sapphi-red/web-noise-suppressor,
https://github.com/xiph/rnnoise, https://github.com/Rikorose/DeepFilterNet.

## The chain, stage by stage

1. **High-pass, 100 Hz, 4th-order Butterworth.** Removes mains hum, fans and
   desk thumps before the suppressor sees them.
2. **Noise suppression (GTCRN).** Mixes the model output with the dry signal,
   delayed by the same amount, according to the strength (1 is model only, 0 is
   dry only). Until the model compiles, the dry signal passes with the same
   delay, so switching never jumps in time. Switched off for more than 1 s, the
   model stops running.
3. **Voice-activity gate.** The detector looks 128 samples (2.7 ms) ahead, so
   word onsets pass whole. Opens 6 dB above the noise floor, closes 3 dB below
   that, holds 200 ms, opens in 1 ms, closes in 80 ms. The noise floor is the
   minimum of the last 2 s.
4. **AGC, compressor and limiter.** The AGC learns only from voice, slowly
   (6 dB/s), towards -21 dBFS. The compressor is gentle (2:1 above -12 dBFS,
   6 dB knee). The limiter, always on, holds peaks at -1 dBFS.
5. **Split-band de-esser.** Only the band above 5.5 kHz goes down, and only
   when it dominates (sibilance).

Each stage switches through a 10 ms ramp (20 ms for suppression), so nothing
clicks (`cadeia.test.ts`).

### Manual microphone sensitivity

The default is **Automatic**: the gate follows the noise floor. In manual mode
(`call.audio.definirLimiar(db)`, -80 to 0 dBFS):

- The level is measured where the automatic detector measures it: after the
  high-pass, suppression and input volume, before the AGC.
- Same hysteresis and timings as automatic mode.
- When closed, the output is **digital silence**. Opus DTX stops sending
  packets, and the speaking ring does not light up on the other side.
- A manual threshold turns the gate on even if the gate stage or the whole
  profile is off.
- It applies live, without recreating the worklet.
- `medir().portaoDb` is the level at the gate. `medir().anelDb` drives the
  speaking ring. `call.audio.medidor(true)` measures outside a call.
- The threshold is per device. It does not travel with the account.

Tests: `limiar.test.ts` and `controlo.test.ts`.

### Profiles

| Profile | Stages | Strength | Gate floor | AGC max | De-esser max |
|---|---|---|---|---|---|
| Off | none: the browser capture as is | | | | |
| Light | all except the de-esser | 0.6 | -12 dB | +6 dB | |
| Normal (default) | all | 1 | -30 dB | +9 dB | 6 dB |
| Maximum | all | 1 | -40 dB | +12 dB | 8 dB |

With our suppression on, `getUserMedia` asks for `noiseSuppression: false`
(two suppressors in series damage the voice twice). With our compressor on, it
asks for `autoGainControl: false`. Echo cancellation stays as the user chose.
If the model fails to compile, the native suppressor is requested again.

## The API (`Call.audio`)

```ts
call.audio.perfil(): "desligado" | "leve" | "normal" | "maximo"
call.audio.definirPerfil(p): Promise<void>
call.audio.etapas(): Readonly<Record<"passaAlto"|"supressao"|"gate"|"compressor"|"deEsser", boolean>>
call.audio.definirEtapa(nome, ligada): Promise<void>
call.audio.forcaDaSupressao(): number                 // 0 to 1
call.audio.definirForcaDaSupressao(v): Promise<void>
call.audio.medir(): { entradaDb; saidaDb; ruidoEstimadoDb; cpuMs; portaoDb; vozAtiva; anelDb }
call.audio.previa(ligada): Promise<void>
call.audio.limiar(): number | null                     // null = automatic
call.audio.definirLimiar(db | null): void              // applies now, does not save
call.audio.medidor(ligado): Promise<void>              // measure without speakers
call.audio.estado(): EstadoDoAudio                     // { perfil, etapas, forca, previa, motor }
call.audio.ligarPreferencias(fonte): () => void
call.on("audio", (estado: EstadoDoAudio) => …)
```

- `definirPerfil` resets stages and strength. `definirEtapa` and
  `definirForcaDaSupressao` adjust on top of it.
- Choices are saved under `audio.perfil`, `audio.etapas` and `audio.forca`
  through `fonte.definirPreferencia`, and sync across the account's devices.
  A `Session` works as the source directly.
- `previa(true)` plays the chain's output to the speakers, in or out of a call.
- `estado().motor` is `"modelo"`, `"a-carregar"`, `"nativo"` or `"nenhum"`.
- Changing profile mid-call applies at once, except for a call that started
  on "Off": it has no chain, so the new profile applies on the next capture.

### Errors

Rejections that can reach the interface: `audio-invalid-profile`,
`audio-invalid-stage`, `audio-invalid-strength`, `audio-preference-save-failed`,
`audio-preview-unavailable`, `audio-preview-failed`, `audio-invalid-threshold`,
`audio-meter-denied`, `audio-meter-failed`. Details are in the error's `cause`.

Model failures never reach the screen. They become the diagnostics
`audio-modelo-falhou` or `audio-modelo-nao-carregou`, and the chain falls back
to the native suppressor.

## Security and packaging

- The web app's CSP (`apps/web/index.html`) adds `'wasm-unsafe-eval'` to
  `script-src`, and nothing else. It allows compiling WebAssembly. It does not
  allow `eval`, `new Function` or inline scripts.
- The worklet and the `.wasm` are loaded through `import("…?url")`. Vite copies
  them to `/app/assets/` with a hash, and they load only when the first chain
  starts.
- In Electron, the CSP lives in `apps/client/src/main/index.ts` (header) and
  `apps/client/src/renderer/index.html` (meta tag). Both include
  `'wasm-unsafe-eval'`. `scripts/audio-electron.mjs` proves it in a real
  Electron window, including the fallback when the keyword is missing.

## Measurements

### Against the browser's native suppressor (Chromium, live)

`scripts/e2e-audio.mjs` feeds Chromium's fake microphone with synthetic voice
and noise at 5 dB. Noise removed from the pauses, and change in voice level:

| Noise | Native: noise removed / voice | **Ours ("Normal")**: noise removed / voice |
|---|---|---|
| White | 18.3 dB / -1.5 dB | **43.2 dB / +0.7 dB** |
| Pink | 19.7 dB / -3.2 dB | **36.3 dB / +0.8 dB** |
| Fan | 23.7 dB / -4.1 dB | **36.7 dB / +0.2 dB** |
| Keyboard | 3.3 dB / -1.5 dB | **47.0 dB / +1.1 dB** |

The test fails if "Normal" gains less than 10 dB on steady noise or lowers the
voice by more than 1 dB (`cadeia.test.ts`).

### Latency and CPU

- **Added delay:** 34.5 ms (31.9 ms for the model, 2.7 ms for the gate's
  look-ahead). Constant when stages are switched.
- **Per 128-sample block (2.67 ms of audio), Node:** mean 0.062 ms, p99
  0.33 ms, max 0.40 ms.
- **Offline render in browsers:** about 4 % of one core in Chromium, Firefox
  and WebKit.

## Tests

- `cadeia.test.ts`: the audio itself (SNR per stage and profile, delay, CPU,
  click-free ramps, de-esser, limiter, engine failures).
- `controlo.test.ts`: the API, preferences, calls, failures, preview.
- `scripts/e2e-audio.mjs`: Chromium, Firefox and WebKit with the app's CSP.
  Run with `npx tsc -b && node scripts/e2e-audio.mjs`.
