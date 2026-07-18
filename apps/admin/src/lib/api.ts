import type { ZodType } from 'zod'

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      error?: string
    }
    throw new AdminApiError(
      response.status,
      payload.error ?? 'The local admin service could not complete the request.',
    )
  }
  if (response.status === 204) return null
  return response.json()
}

export async function getJson<T>(
  path: string,
  schema: ZodType<T>,
): Promise<T> {
  return schema.parse(await request(path))
}

export async function postJson<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  return schema.parse(await request(path, {
    method: 'POST',
    body: JSON.stringify(body)
  }))
}

export async function postEmpty(path: string): Promise<void> {
  await request(path, { method: 'POST' })
}
