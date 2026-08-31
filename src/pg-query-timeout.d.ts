import 'pg'

declare module 'pg' {
  interface QueryConfig<I = any[]> {
    /** Supported by node-postgres at query dispatch; absent from @types/pg. */
    query_timeout?: number
  }
}
