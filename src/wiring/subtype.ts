import { Controller } from '../controller';
import { Schema, SubType, SubTypeRestriction } from '../schema-type';
import { BasePrimitive, basePrimitives, validator } from './_constants';

function numberOrFail(restriction: SubTypeRestriction, subType: SubType): number {
  if (restriction.value.type !== 'Number') {
    throw new Error(`Expected ${subType.name} restriction ${restriction.name} to have an accompanying number value but we found a ${restriction.value.type}`);
  }
  return restriction.value.value;
}

function stringOrFail(restriction: SubTypeRestriction, subType: SubType): string {
  if (restriction.value.type !== 'String') {
    throw new Error(`Expected ${subType.name} restriction ${restriction.name} to have an accompanying string value but we found a ${restriction.value.type}`);
  }
  return restriction.value.value;
}

function booleanOrFail(restriction: SubTypeRestriction, subType: SubType): boolean {
  if (restriction.value.type !== 'Boolean') {
    throw new Error(`Expected ${subType.name} restriction ${restriction.name} to have an accompanying boolean value but we found a ${restriction.value.type}`);
  }
  return restriction.value.value;
}

function restrictionCheck(restriction: SubTypeRestriction, subType: SubType, basePrimitive: BasePrimitive): string {
  switch (basePrimitive) {
    case 'string': {
      switch (restriction.name) {
        case 'minLength':
          return `value.length >= ${numberOrFail(restriction, subType)}`;
        case 'maxLength':
          return `value.length <= ${numberOrFail(restriction, subType)}`;
        case 'startsWith':
          return `value.startsWith(${JSON.stringify(stringOrFail(restriction, subType))})`;
        case 'endsWith':
          return `value.endsWith(${JSON.stringify(stringOrFail(restriction, subType))})`;
      }
      break;
    }
    case 'number': {
      switch (restriction.name) {
        case 'minValue':
          return `value >= ${numberOrFail(restriction, subType)}`;
        case `maxValue`:
          return `value <= ${numberOrFail(restriction, subType)}`;
      }
    }
    case 'boolean': {
      // TODO: Nothing here?
    }
  }
  throw new Error(`Unsupported subType refiner ${restriction.name} on a base primitive of ${basePrimitive} while generating ${subType.name}`);
}

export function wireSubType(subType: SubType, controller: Controller, schema: Schema): void {
  const subTypeDeclaration = [`export type ${subType.name} = ${subType.parent};`];

  const parentValidator = basePrimitives.includes(subType.parent)
    ? [`if (typeof value !== '${subType.parent}') return false;`]
    : [`if (!${validator(subType.parent)}(value)) return false;`];

  let basePrimitive = subType.name;
  const visitedTypes = new Set();
  while (!basePrimitives.includes(basePrimitive)) {
    if (visitedTypes.has(basePrimitive)) {
      throw new Error(`SubType ${subType.name} has no resolvable base type, we encountered a cycle while tracing the subtype`);
    }
    visitedTypes.add(basePrimitive);

    const type = schema.body.find((elem) => elem.type === 'SubType' && elem.name === basePrimitive) as SubType;
    if (!type) {
      throw new Error(`While tracing SubType ${subType.name} we reached ${basePrimitive} which does not appear in a reachable schema`);
    }

    basePrimitive = type.parent;
  }

  const subTypeValidatorDeclaration = [
    `export function ${validator(subType.name)}(value: any): boolean {`,
    ...parentValidator,
    ...subType.restrictions.map((restriction) => `if (!(${restrictionCheck(restriction, subType, basePrimitive as BasePrimitive)})) return false;`),
    `  return true;`,
    `}`,
  ];
  controller.addCommonCode(subTypeDeclaration.join('\n'));
  controller.addCommonCode(subTypeValidatorDeclaration.join('\n'));
  controller.addCommonExport(subType.name);
  controller.addCommonExport(validator(subType.name));
  controller.addPublicCommonExport(subType.name);
}
