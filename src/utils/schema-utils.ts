import { SchemaValidator } from '@0x/json-schemas';
import * as AJV from 'ajv';
import { ValidationError, ValidationErrorCodes, ValidationErrorItem } from '../errors';
import { schemas } from '../schemas';

const schemaValidator = new SchemaValidator();
for (const schema of Object.values(schemas)) {
  if (schema !== undefined) {
    schemaValidator.addSchema(schema);
  }
}

function schemaValidationErrorToValidationErrorItem(schemaValidationErrorObject: AJV.ErrorObject): ValidationErrorItem {
  if (
    [
      'type',
      'anyOf',
      'allOf',
      'oneOf',
      'additionalProperties',
      'minProperties',
      'maxProperties',
      'pattern',
      'format',
      'uniqueItems',
      'items',
      'dependencies',
    ].includes(schemaValidationErrorObject.keyword)
  ) {
    return {
      field: schemaValidationErrorObject.schemaPath.replace('.', ''),
      code: ValidationErrorCodes.IncorrectFormat,
      reason: schemaValidationErrorObject.message || '',
    };
  } else if (
    ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'enum', 'const'].includes(
      schemaValidationErrorObject.keyword,
    )
  ) {
    return {
      field: schemaValidationErrorObject.schemaPath.replace('.', ''),
      code: ValidationErrorCodes.ValueOutOfRange,
      reason: schemaValidationErrorObject.message || '',
    };
  } else if (schemaValidationErrorObject.keyword === 'required') {
    return {
      field: schemaValidationErrorObject.params.missingProperty,
      code: ValidationErrorCodes.RequiredField,
      reason: schemaValidationErrorObject.message || '',
    };
  } else if (schemaValidationErrorObject.keyword === 'not') {
    return {
      field: schemaValidationErrorObject.schemaPath.replace('.', ''),
      code: ValidationErrorCodes.UnsupportedOption,
      reason: schemaValidationErrorObject.message || '',
    };
  } else {
    throw new Error(`Unknown schema validation error name: ${schemaValidationErrorObject.keyword}`);
  }
}

export function validateSchema(instance: any, schema: object): void {
  const validationResult = schemaValidator.validate(instance, schema);
  if (!validationResult.errors || validationResult.errors.length === 0) {
    return;
  } else {
    const validationErrorItems = validationResult.errors.map((schemaValidationError) =>
      schemaValidationErrorToValidationErrorItem(schemaValidationError as any),
    );
    throw new ValidationError(validationErrorItems);
  }
}

export function addSchema(schema: object): void {
  schemaValidator.addSchema(schema);
}
