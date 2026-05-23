// NOTE:
// This file previously declared loose React module shims.
// That can break TypeScript's ability to infer the correct generic
// signatures for React hooks (e.g. useState<T>), causing errors like:
//   ts(2347) Untyped function calls may not accept type arguments.
//
// It is intentionally left empty so React can use the real type
// definitions from @types/react / react.
export {};


