# Tandem source provenance

The files under `web/src` are copied without modification from
`ashwinjyoti-ship-it/unified-doc-management` at commit
`093e4dd5b945214dc91b31caf9437a3f2278ca13`.

Poppin compiles the exact relevant Markdown functions in
`src/tandem/markdownToPdfHtml.ts`. The native React adapter sanitizes the
resulting HTML at the application boundary.
