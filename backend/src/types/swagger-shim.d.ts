// Ambient shims for dev-only documentation packages (swagger-jsdoc is a
// devDependency; with NODE_ENV=production npm install skips devDeps, so the
// packages and their @types may be absent at build time). The shims make the
// imports type-safe-as-any in every environment without @types packages.
declare module 'swagger-jsdoc';
declare module 'swagger-ui-express';
