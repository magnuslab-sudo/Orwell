/**
 * `?url` comes from the bundler (Vite, with electron-vite on top): the file is
 * copied to the output with the hash in its name, and the import returns the address.
 * This is how the worklet module and `.wasm` are served by the site itself,
 * never by CDN. Used only via dynamic `import()` inside functions: `tsc`
 * leaves it unchanged, and none of this reaches public declarations.
 */
declare module "*?url" {
  const endereco: string
  export default endereco
}
