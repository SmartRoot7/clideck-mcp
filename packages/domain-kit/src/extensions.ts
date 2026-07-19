import type { JsonObject } from './json.js'

export type ArtifactReference = {
  provider: string
  key: string
  media_type: string
  content_hash: string
  metadata: JsonObject
}

export interface ArtifactStore {
  put(input: {
    content: Uint8Array
    media_type: string
    metadata: JsonObject
  }): Promise<ArtifactReference>
  get(reference: ArtifactReference): Promise<Uint8Array>
  delete(reference: ArtifactReference): Promise<void>
}

export type SpatialPoint = {
  longitude: number
  latitude: number
  altitude_meters?: number
}

export interface SpatialProvider {
  validate(point: SpatialPoint): Promise<void>
  nearby(input: {
    point: SpatialPoint
    radius_meters: number
    limit: number
  }): Promise<Array<{
    record_ref: string
    distance_meters: number
  }>>
}

export type DomainRelation = {
  subject_ref: string
  relation_type: string
  object_ref: string
  attributes: JsonObject
}

export interface RelationProvider {
  list(input: {
    record_ref: string
    relation_type?: string
    direction?: 'incoming' | 'outgoing' | 'both'
  }): Promise<DomainRelation[]>
}

export type LabValidationResult = {
  passed: boolean
  validation_level: string
  summary: string
  report_hash: string
  metadata: JsonObject
}

export interface LabValidator {
  validate(input: {
    domain_id: string
    record_type: string
    context: JsonObject
    payload: JsonObject
  }): Promise<LabValidationResult>
}
