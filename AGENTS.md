# Architecture rules

- Decompress SQL.GZ uploads with the browser's DecompressionStream before using the shared SQL dump parser, so compressed imports remain entirely client-side without another runtime dependency.
- Share database filename validation between upload entry points so file selection and drag-and-drop accept the same formats.