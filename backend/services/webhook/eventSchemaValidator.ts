/**
 * EventSchemaValidator — Validates webhook event payloads against
 * the JSON Schema definitions in the event catalog.
 */

import { eventCatalog, type SchemaField } from './eventCatalog';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class EventSchemaValidator {
  validate(eventType: string, payload: Record<string, unknown>): ValidationResult {
    const definition = eventCatalog.getEvent(eventType);
    if (!definition) {
      return { valid: false, errors: [`Unknown event type: ${eventType}`] };
    }

    const errors: string[] = [];
    const schema = definition.payloadSchema;

    for (const [field, spec] of Object.entries(schema)) {
      const value = payload[field];

      if (spec.required && (value === undefined || value === null)) {
        errors.push(`Missing required field: ${field}`);
        continue;
      }

      if (value !== undefined && value !== null) {
        if (!this.checkType(value, spec)) {
          errors.push(`Field "${field}" expected type "${spec.type}", got "${typeof value}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private checkType(value: unknown, spec: SchemaField): boolean {
    switch (spec.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  generateExample(eventType: string): Record<string, unknown> | null {
    const definition = eventCatalog.getEvent(eventType);
    if (!definition) return null;

    const example: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(definition.payloadSchema)) {
      if (spec.example !== undefined) {
        example[field] = spec.example;
      } else {
        example[field] = this.defaultForType(spec.type);
      }
    }
    return example;
  }

  private defaultForType(type: string): unknown {
    switch (type) {
      case 'string': return '';
      case 'number': return 0;
      case 'boolean': return false;
      case 'object': return {};
      case 'array': return [];
      default: return null;
    }
  }
}

export const eventSchemaValidator = new EventSchemaValidator();
